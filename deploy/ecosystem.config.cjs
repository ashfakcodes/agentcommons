module.exports = {
  apps: [
    {
      name: 'agentcommons-relayer',
      cwd: '/var/www/agentcommons/server',
      script: 'dist/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '800M',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
        HOST: '127.0.0.1',
      },
    },
  ],
};
