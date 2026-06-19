import { ethers, network, upgrades } from "hardhat";

/**
 * In-place upgrade of the existing TankDawgs proxy to the registry-aware
 * implementation, then point it at the DDawgsNFTRegistry. Preserves the proxy
 * address + all state (games, wiring) — no env/server/web changes needed.
 *
 * Set PROXY + REGISTRY for the target network (defaults are the Sepolia ones).
 */
const PROXY = process.env.TANKDAWGS_PROXY || "0xa49b6F18c037BddB81357D194F1D23deA9BA041B";
const REGISTRY = process.env.DDAWGS_REGISTRY || "0x4C643a8DD0050f0B5fF6E195CEc29D3e01003205";

async function main() {
  const [signer] = await ethers.getSigners();
  console.log(`Upgrading TankDawgs ${PROXY} on ${network.name} as ${signer.address}`);

  const Factory = await ethers.getContractFactory("TankDawgs");
  const upgraded = await upgrades.upgradeProxy(PROXY, Factory);
  await upgraded.waitForDeployment();
  console.log("  implementation →", await upgrades.erc1967.getImplementationAddress(PROXY));

  // registry storage persists across upgrades — only set it if not already wired.
  if ((await upgraded.registry()).toLowerCase() !== REGISTRY.toLowerCase()) {
    await (await upgraded.setRegistry(REGISTRY)).wait();
  }
  console.log("  registry →", await upgraded.registry());
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
