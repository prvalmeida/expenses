import { NextResponse } from 'next/server';
import connectToDatabase from '../../../../lib/mongodb';
import { BillMapping } from '../../../../lib/models/BillMapping';
import { billMappingKey } from '../../../../lib/utils/billUtils';

/**
 * One-off migration: collapse interior whitespace in existing BillMapping keys.
 *
 * Mappings learned before the bill parsers normalized descriptions were stored with the
 * multi-space column gaps intact ("pastel   da banca"). The parsers now emit single spaces, so
 * those docs would never match again and re-confirming would upsert a duplicate.
 *
 * `description` is uniquely indexed, so two old docs can normalize onto the same key. On a
 * collision the newest doc wins (ObjectIds are time-ordered, and the latest confirmation is the
 * most likely to reflect what the user wants today); the losers are deleted and reported.
 */
export async function POST() {
  try {
    await connectToDatabase();

    const all = await BillMapping.find({}).sort({ _id: 1 });

    const groups = new Map<string, typeof all>();
    for (const doc of all) {
      const key = billMappingKey(doc.description);
      const group = groups.get(key);
      if (group) group.push(doc);
      else groups.set(key, [doc] as typeof all);
    }

    let renamed = 0;
    const collisions: { key: string; kept: string; discarded: string[] }[] = [];

    for (const [key, docs] of groups) {
      // Sorted by _id ascending, so the last doc is the most recently written.
      const survivor = docs[docs.length - 1];
      const losers = docs.slice(0, -1);

      if (losers.length > 0) {
        // Delete first: the unique index would reject the rename while duplicates still exist.
        await BillMapping.deleteMany({ _id: { $in: losers.map(d => d._id) } });
        collisions.push({
          key,
          kept: `${survivor.type}${survivor.subtype ? ` / ${survivor.subtype}` : ''}`,
          discarded: losers.map(d => `${d.description} → ${d.type}${d.subtype ? ` / ${d.subtype}` : ''}`),
        });
      }

      if (survivor.description !== key) {
        await BillMapping.updateOne({ _id: survivor._id }, { $set: { description: key } });
        renamed++;
      }
    }

    return NextResponse.json({
      scanned: all.length,
      renamed,
      duplicatesRemoved: collisions.reduce((n, c) => n + c.discarded.length, 0),
      collisions,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Falha ao normalizar BillMappings: ${error}` },
      { status: 500 }
    );
  }
}
