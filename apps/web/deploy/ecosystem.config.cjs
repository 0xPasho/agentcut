// pm2 on the owner's box, beside postgun's own ecosystem file. The bundle reads its
// secrets from ~/agentcut/.env itself (node's loadEnvFile), so nothing is kept here.
//   pm2 start ecosystem.config.cjs && pm2 save      # the first time
//   pm2 restart agentcut-web --update-env           # every deploy (deploy.sh does it)
module.exports = {
  apps: [
    {
      name: "agentcut-web",
      cwd: __dirname,
      script: "dist/server.mjs",
      env: {
        NODE_ENV: "production",
        // nginx proxies agentcut.studio here. 3000–3012 are the other apps on this box.
        PORT: 3013,
      },
      max_memory_restart: "512M",
    },
  ],
};
