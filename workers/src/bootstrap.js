if (!process.env.LOG_SERVICE) process.env.LOG_SERVICE = 'beezmovies-worker';
await import('./index.js');
