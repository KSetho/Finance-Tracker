import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ws must stay unbundled: webpack breaks its optional native masking used by the Neon driver.
  serverExternalPackages: ["@node-rs/argon2", "nodemailer", "ws"],
};

export default nextConfig;
