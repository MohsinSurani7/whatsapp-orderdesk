import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "*.trycloudflare.com",
    "correspondence-projects-qualifications-mason.trycloudflare.com",
  ],
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
