// Vercel serverless entry point — mounts the SIMCOVA API on the Node.js runtime
import express from 'express';
import { initDatabase } from '../server/db.ts';
import { createApiRouter } from '../server/routes.ts';

// Cold-start: initialize the DB schema/seed once per lambda instance
await initDatabase();

const app = express();
app.set('trust proxy', 1);
app.use(
  express.json({
    limit: '4mb', // Vercel serverless body limit
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  })
);
app.use('/api', await createApiRouter());

export default app;
