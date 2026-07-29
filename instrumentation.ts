export async function register() {
  // Mongoose only runs in the Node.js runtime, and seeding is a boot-time
  // concern — skip the Edge runtime entirely.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { Category } = await import('./lib/models/Category');
  const { seedCategories } = await import('./lib/utils/categoryUtils');
  const connectToDatabase = (await import('./lib/mongodb')).default;

  try {
    await connectToDatabase();
    // First-run guard: only seed an empty collection so cloud instances don't
    // re-run the upserts on every cold start. POST /api/categories/seed remains
    // the path for a forced reseed.
    const existing = await Category.countDocuments({ kind: 'expense' });
    if (existing === 0) {
      const { expense, income } = await seedCategories();
      console.log(`[seed] categories seeded: ${expense} expense, ${income} income`);
    }
  } catch (error) {
    // Never crash boot on a seeding/DB hiccup — a healthy later boot will retry.
    console.error('[seed] category seed skipped:', error);
  }
}
