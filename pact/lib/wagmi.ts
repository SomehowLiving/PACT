import { http, createConfig, createStorage, cookieStorage } from "wagmi";
import { arc, base } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const config = createConfig({
  chains: [base, arc],
  connectors: [injected()],
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
  transports: {
    [arc.id]: http(),
    [base.id]: http(
      process.env.NEXT_PUBLIC_EVM_RPC_URL || "https://mainnet.base.org",
    ),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
};
