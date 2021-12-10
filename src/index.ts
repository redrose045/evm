import KYVE from "@kyve/core";
import { BlockInstructions } from "@kyve/core/dist/src/faces";
import { version } from "../package.json";
import { SafeProvider, sleep } from "./worker";
import cliProgress from "cli-progress";
import chalk from "chalk";

process.env.KYVE_RUNTIME = "@kyve/evm";
process.env.KYVE_VERSION = version;

KYVE.metrics.register.setDefaultLabels({
  app: process.env.KYVE_RUNTIME,
});

class EVM extends KYVE {
  public async worker() {
    const batchSize = 1000;
    const rateLimit = 10;

    while (true) {
      try {
        const provider = new SafeProvider(this.poolState.config.rpc);
        const batch: any[] = [];

        let workerHeight;

        try {
          workerHeight = await this.db.get(-1);
        } catch {
          await this.db.put(-1, 0);
          workerHeight = 0;
        }

        for (
          let height = workerHeight;
          height < workerHeight + batchSize;
          height++
        ) {
          batch.push(provider.safeGetBlockWithTransactions(height));
          await sleep(rateLimit);
        }

        await Promise.all(batch);

        batch.map((b) => ({
          type: "put",
          key: b.number,
          value: b,
        }));

        await this.db.batch(batch);
        await this.db.put(-1, workerHeight + batchSize);
        await sleep(rateLimit * 10);
      } catch (error) {
        sleep(10 * 1000);
      }
    }
  }

  public async createBundle(
    blockInstructions: BlockInstructions
  ): Promise<any[]> {
    const bundleDataSizeLimit = 50 * 1000 * 1000; // 50 MB
    const bundle: any[] = [];

    const progress = new cliProgress.SingleBar({
      format: `${chalk.gray(
        new Date().toISOString().replace("T", " ").replace("Z", " ")
      )} ${chalk.bold.blueBright(
        "INFO"
      )} [{bar}] {percentage}% | ETA: {eta}s | {value}/{total} bytes`,
    });

    progress.start(bundleDataSizeLimit, 0);

    let currentDataSize = 0;
    let currentHeight = blockInstructions.fromHeight;

    while (true) {
      try {
        const block = await this.db.get(currentHeight);

        currentDataSize += KYVE.dataSizeOfString(JSON.stringify(block));
        currentHeight += 1;

        if (currentDataSize <= bundleDataSizeLimit) {
          bundle.push(block);
        } else {
          break;
        }
      } catch {
        sleep(10 * 1000);
      }
    }

    return bundle;
  }
}

new EVM().start();
