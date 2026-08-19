import pg from "pg";
const c = new pg.Client({ connectionString: "postgresql://blaze:58f24da829f2866bf9f9e3ed929e77e6@95.111.248.246:5501/blaze" });
await c.connect();
const seen = new Set((await c.query("select ts from database_metrics order by ts desc limit 20")).rows.map(r => r.ts.toISOString()));
const base = (await c.query("select max(ts) as latest from database_metrics")).rows[0].latest;
console.log("baseline:", base.toISOString(), "— no deploys, no manual triggers from here");
const found = [];
const deadline = Date.now() + 12 * 60_000;
while (Date.now() < deadline && found.length < 2) {
  await new Promise(r => setTimeout(r, 20_000));
  const rows = (await c.query("select ts from database_metrics where ts > $1 order by ts", [base])).rows;
  for (const r of rows) {
    const iso = r.ts.toISOString();
    if (!seen.has(iso)) { seen.add(iso); found.push(r.ts); console.log("  tick:", iso); }
  }
}
if (found.length >= 2) {
  console.log(`\nrecurring confirmed — gap between ticks: ${Math.round((found[1]-found[0])/1000)}s`);
} else {
  console.log(`\nonly ${found.length} tick(s) observed in 12 minutes`);
}
await c.end();
