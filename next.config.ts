import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  devIndicators: false,
  // The SDK loads form-data etc. with dynamic require, which the bundler can't follow
  serverExternalPackages: ["@daytona/sdk"],
}

export default nextConfig
