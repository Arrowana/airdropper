import * as anchor from "@project-serum/anchor";
import { AnchorError, AnchorProvider, Program } from "@project-serum/anchor";
import { token } from "@project-serum/anchor/dist/cjs/utils";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  Token,
  TOKEN_PROGRAM_ID,
  u64,
} from "@solana/spl-token";
import {
  AccountMeta,
  AddressLookupTableProgram,
  ComputeBudgetInstruction,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { Airdropper } from "../target/types/airdropper";
import { sleep } from "./sleep";

describe("airdropper", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Airdropper as Program<Airdropper>;

  it("Compare some stuff", async () => {
    const anchorProvider = anchor.AnchorProvider.env();
    const payer = (anchorProvider.wallet as any).payer as any as Keypair;
    const provider = program.provider;
    // const payer = new Keypair();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(payer.publicKey, 10_000_000_000),
      "confirmed"
    );

    const token = await Token.createMint(
      program.provider.connection,
      payer,
      payer.publicKey,
      payer.publicKey,
      0,
      TOKEN_PROGRAM_ID
    );
    const ata = await token.createAssociatedTokenAccount(payer.publicKey);
    await token.mintTo(ata, payer.publicKey, [], 100_000);

    // vanilla airdrop, max X recipients
    const tx = new Transaction();
    for (const _ of Array(10)) {
      const owner = new Keypair().publicKey;
      console.log("owner:", owner.toBase58());
      const recipientAta = findAssociatedTokenAddress({
        walletAddress: owner,
        tokenMintAddress: token.publicKey,
      });
      tx.add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          recipientAta,
          owner,
          token.publicKey
        )
      );
      tx.add(
        Token.createTransferInstruction(
          TOKEN_PROGRAM_ID,
          ata,
          recipientAta,
          payer.publicKey,
          [],
          1
        )
      );
    }

    const signature = await provider.connection.sendTransaction(tx, [payer]);
    console.log(signature);

    // Through airdrop program, reduces X * 8 amount + ix overhead to 1 x amount
    const remainingAccounts = new Array<AccountMeta>();
    for (const _ of Array(12)) {
      const owner = new Keypair().publicKey;
      console.log("owner:", owner.toBase58());
      const recipientAta = findAssociatedTokenAddress({
        walletAddress: owner,
        tokenMintAddress: token.publicKey,
      });
      remainingAccounts.push({
        pubkey: owner,
        isWritable: true,
        isSigner: false,
      });
      remainingAccounts.push({
        pubkey: recipientAta,
        isWritable: true,
        isSigner: false,
      });
    }

    const airdropSignature = await program.methods
      .airdrop(new anchor.BN(1))
      .accountsStrict({
        payer: payer.publicKey,
        tokenAccount: ata,
        mint: token.publicKey,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ])
      .remainingAccounts(remainingAccounts)
      .rpc();
    console.log("Your transaction signature", airdropSignature);

    // airdropper using ALT for the common programs we cpi to
    const altTx = new Transaction();
    const recentSlot = await provider.connection.getSlot("confirmed");
    const [createLT, lookupTable] = AddressLookupTableProgram.createLookupTable(
      {
        authority: payer.publicKey,
        payer: payer.publicKey,
        recentSlot,
      }
    );
    altTx.add(createLT);
    altTx.add(
      AddressLookupTableProgram.extendLookupTable({
        lookupTable,
        authority: payer.publicKey,
        payer: payer.publicKey,
        addresses: [
          ASSOCIATED_TOKEN_PROGRAM_ID,
          TOKEN_PROGRAM_ID,
          SystemProgram.programId,
          // Those are not static across airdroppers but let's stretch it
          ata,
          token.publicKey,
        ],
      })
    );
    const createAltSignature = await provider.connection.sendTransaction(
      altTx,
      [payer]
    );
    console.log("createAltSignature:", createAltSignature);

    await sleep(5_000);
    const addressLookupTableAccount = (
      await provider.connection.getAddressLookupTable(lookupTable)
    ).value;
    console.log(addressLookupTableAccount);

    const newRemainingAccounts = new Array<AccountMeta>();
    for (const _ of Array(14)) {
      const owner = new Keypair().publicKey;
      console.log("owner:", owner.toBase58());
      const recipientAta = findAssociatedTokenAddress({
        walletAddress: owner,
        tokenMintAddress: token.publicKey,
      });
      newRemainingAccounts.push({
        pubkey: owner,
        isWritable: true,
        isSigner: false,
      });
      newRemainingAccounts.push({
        pubkey: recipientAta,
        isWritable: true,
        isSigner: false,
      });
    }

    const airdropIx = await program.methods
      .airdrop(new anchor.BN(1))
      .accountsStrict({
        payer: payer.publicKey,
        tokenAccount: ata,
        mint: token.publicKey,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(newRemainingAccounts)
      .instruction();

    const blockhashAndLastValidBlockheight =
      await provider.connection.getLatestBlockhash();
    const transactionMessage = new TransactionMessage({
      payerKey: payer.publicKey,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        airdropIx,
      ],
      recentBlockhash: blockhashAndLastValidBlockheight.blockhash,
    });
    const messageV0 = transactionMessage.compileToV0Message([
      addressLookupTableAccount,
    ]);
    const versionedTransaction = new VersionedTransaction(messageV0);
    versionedTransaction.sign([payer]);
    const airdropCompressedSignature =
      await provider.connection.sendRawTransaction(
        versionedTransaction.serialize()
      );

    console.log("Your transaction signature", airdropCompressedSignature);
  });
});

export function createAssociatedTokenAccountInstruction(
  payer: PublicKey,
  associatedToken: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID
): TransactionInstruction {
  const keys = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: associatedToken, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: false, isWritable: false },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    keys,
    programId: associatedTokenProgramId,
    data: Buffer.from([1]),
  });
}

export const findAssociatedTokenAddress = ({
  walletAddress,
  tokenMintAddress,
}: {
  walletAddress: PublicKey;
  tokenMintAddress: PublicKey;
}): PublicKey => {
  return PublicKey.findProgramAddressSync(
    [
      walletAddress.toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      tokenMintAddress.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
};
