// Imported first by cli.js: ES modules evaluate their imports before the importer's body,
// so .env must load here for config.js and spender.js to see it.
try {
  process.loadEnvFile('.env');
} catch {}
