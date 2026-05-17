declare module "next-pwa" {
  type PwaConfig = {
    dest: string;
    register?: boolean;
    skipWaiting?: boolean;
    disable?: boolean;
    runtimeCaching?: Array<Record<string, unknown>>;
  };

  export default function withPWA(config: PwaConfig): <T>(nextConfig: T) => T;
}
