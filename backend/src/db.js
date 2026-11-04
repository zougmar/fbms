const mongoose = require('mongoose');
const dns = require('dns').promises;

async function standardUri(uri) {
  if (!uri.startsWith('mongodb+srv://')) return uri;

  const parsed = new URL(uri.replace('mongodb+srv://', 'http://'));
  const records = await dns.resolveSrv(`_mongodb._tcp.${parsed.hostname}`);
  if (!records.length) return uri;

  const user = encodeURIComponent(decodeURIComponent(parsed.username));
  const pass = encodeURIComponent(decodeURIComponent(parsed.password));
  const db = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '/';
  const params = new URLSearchParams(parsed.search.replace(/^\?/, ''));
  if (!params.has('tls') && !params.has('ssl')) params.set('tls', 'true');
  if (!params.has('authSource')) params.set('authSource', 'admin');

  const hosts = records.map((record) => `${record.name.replace(/\.$/, '')}:${record.port || 27017}`);

  if (!params.has('replicaSet')) {
    const probeUri = `mongodb://${user}:${pass}@${hosts[0]}${db}?tls=true&authSource=admin&directConnection=true`;
    const probe = mongoose.createConnection(probeUri, { serverSelectionTimeoutMS: 10000 });
    try {
      await probe.asPromise();
      const hello = await probe.db.admin().command({ hello: 1 });
      if (hello.setName) params.set('replicaSet', hello.setName);
    } finally {
      await probe.close().catch(() => {});
    }
  }

  return `mongodb://${user}:${pass}@${hosts.join(',')}${db}?${params.toString()}`;
}

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not set');
  }
  mongoose.set('strictQuery', true);
  // mongodb+srv needs a TXT lookup that times out on this network. SRV hosts still resolve.
  const connectUri = uri.startsWith('mongodb+srv://') ? await standardUri(uri) : uri;
  await mongoose.connect(connectUri, {
    serverSelectionTimeoutMS: 15000,
    maxPoolSize: 30,
    minPoolSize: 2,
    retryWrites: true,
    retryReads: true
  });
  return mongoose.connection;
}

module.exports = { connectDB };
