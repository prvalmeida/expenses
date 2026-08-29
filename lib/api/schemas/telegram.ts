import { z } from 'zod';

export const telegramExpenseTextSchema = z.object({
  text: z.string().trim().min(1, 'Texto é obrigatório'),
  dryRun: z.boolean().optional().default(false),
});

export type TelegramExpenseTextBody = z.infer<typeof telegramExpenseTextSchema>;
