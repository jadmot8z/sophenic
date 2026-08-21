const path = require("node:path");

const projectRoot = path.resolve(__dirname);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Force tracing to the SOPHENIC source root. This prevents an unrelated
  // package-lock.json higher in C:\\Users\\... from relocating server.js.
  outputFileTracingRoot: projectRoot,
  poweredByHeader: false,
  reactStrictMode: true,
  // The desktop renderer serves local assets itself; disabling server-side
  // image optimisation removes the optional native sharp runtime from the EXE.
  images: { unoptimized: true },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" }
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
        ]
      }
    ];
  }
};

module.exports = nextConfig;
