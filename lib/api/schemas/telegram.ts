import { z } from 'zod';

// 4096 is Telegram's own message ceiling — the endpoint exists to receive
// agent/Telegram text, so anything larger is a runaway caller, not a message.
// Without a max, a megabyte payload would be processed line by line by
// collectDraft for nothing.
export const TELEGRAM_TEXT_MAX = 4096;

export const telegramExpenseTextSchema = z.object({
  text: z.string().trim().min(1, 'Texto é obrigatório').max(TELEGRAM_TEXT_MAX, 'Texto deve ter no máximo 4096 caracteres'),
  dryRun: z.boolean().optional().default(false),
});

export type TelegramExpenseTextBody = z.infer<typeof telegramExpenseTextSchema>;
