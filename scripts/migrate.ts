/** Applies database migrations (they also run automatically on first request). */
import { PostgresRepository } from '../src/server/storage/postgresRepository';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const repo = PostgresRepository.fromUrl(url);
repo
  .migrate()
  .then(() => console.log('Migrations applied'))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => repo.close());
