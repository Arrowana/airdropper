use anchor_lang::prelude::*;
use anchor_spl::{associated_token, token};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod airdropper {

    use super::*;

    pub fn airdrop<'info>(
        ctx: Context<'_, '_, '_, 'info, Airdrop<'info>>,
        amount: u64,
    ) -> Result<()> {
        let remaining_accounts_iter = &mut ctx.remaining_accounts.iter();

        while remaining_accounts_iter.len() > 0 {
            let owner = next_account_info(remaining_accounts_iter)?;
            let associated_token = next_account_info(remaining_accounts_iter)?;

            associated_token::create_idempotent(CpiContext::new(
                ctx.accounts.associated_token_program.to_account_info(),
                associated_token::Create {
                    payer: ctx.accounts.payer.to_account_info(),
                    associated_token: associated_token.to_account_info(),
                    authority: owner.clone(),
                    mint: ctx.accounts.mint.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                },
            ))?;

            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    token::Transfer {
                        from: ctx.accounts.token_account.to_account_info(),
                        to: associated_token.to_account_info(),
                        authority: ctx.accounts.payer.to_account_info(),
                    },
                ),
                amount,
            )?;
        }

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Airdrop<'info> {
    #[account(mut)]
    payer: Signer<'info>,
    #[account(mut)]
    token_account: Account<'info, token::TokenAccount>,
    mint: Account<'info, token::Mint>,
    associated_token_program: Program<'info, associated_token::AssociatedToken>,
    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,
    // then tuple of owner and ata
}
