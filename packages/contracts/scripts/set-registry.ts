import { ethers, network, upgrades } from "hardhat";

const PROXY = process.env.TANKDAWGS_PROXY || "0xa49b6F18c037BddB81357D194F1D23deA9BA041B";
const REGISTRY = process.env.DDAWGS_REGISTRY || "0x4C643a8DD0050f0B5fF6E195CEc29D3e01003205";
const CLIENT = "0x14e9D19c867dA8F304f113F1D4661A8F08593Db8";

async function main() {
  const tank = await ethers.getContractAt("TankDawgs", PROXY);
  console.log(`TankDawgs ${PROXY} on ${network.name}`);
  console.log("  implementation:", await upgrades.erc1967.getImplementationAddress(PROXY));

  const current = await tank.registry();
  if (current.toLowerCase() !== REGISTRY.toLowerCase()) {
    await (await tank.setRegistry(REGISTRY)).wait();
  }
  console.log("  registry:", await tank.registry());
  console.log("  ownsNFT(client):", await tank.ownsNFT(CLIENT));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
