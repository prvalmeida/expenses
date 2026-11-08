import { z } from 'zod';
import { isoDate } from './common';
import { MAX_HISTORY_MONTHS } from '../../utils/forecast';

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
// A digest older than this would be a month of "new" records — certainly a
// mis-specified `since`, and a needlessly large read.
const MAX_DIGEST_AGE_DAYS = 31;
// A `since` in the future is a caller clock/time-zone mistake (it would yield an
// empty digest that looks like a quiet day). A few minutes of skew are tolerated.
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

// An empty query value (`?month=`) means "not sent": coercing '' would yield
// NaN and reject a request that merely left a field blank in a client.
const optionalNumber = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(value => (value === '' ? undefined : value), schema.optional());

export const monthForecastQuerySchema = z
  .object({
    month: z
      .string()
      .regex(monthPattern, 'Mês deve estar no formato YYYY-MM')
      .optional(),
    // Only for the backtest and for reporting a month that already closed.
    today: isoDate.optional(),
    savingsGoal: optionalNumber(z.coerce.number().min(0)),
    alertMargin: optionalNumber(z.coerce.number().min(0)),
    historyMonths: optionalNumber(z.coerce.number().int().min(1).max(MAX_HISTORY_MONTHS)),
    // Reconstructs what the forecast would have said on that day: rows stored
    // afterwards are ignored. Only for the backtest — the weekly job never
    // sends it.
    createdBefore: z.string().datetime({ offset: true, message: 'createdBefore deve ser uma data ISO 8601' }).optional(),
  })
  .refine(query => !query.month || !query.today || query.today.slice(0, 7) === query.month, {
    path: ['today'],
    message: 'today deve estar dentro do mês consultado',
  });

export const dailyDigestQuerySchema = z.object({
  since: z
    .string()
    .datetime({ offset: true, message: 'since deve ser uma data ISO 8601' })
    .refine(
      value => Date.now() - Date.parse(value) <= MAX_DIGEST_AGE_DAYS * 86_400_000,
      'since não pode ser mais antigo que 31 dias'
    )
    .refine(value => Date.parse(value) <= Date.now() + MAX_CLOCK_SKEW_MS, 'since não pode estar no futuro'),
});

export type MonthForecastQuery = z.infer<typeof monthForecastQuerySchema>;
export type DailyDigestQuery = z.infer<typeof dailyDigestQuerySchema>;
