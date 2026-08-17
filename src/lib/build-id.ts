import { readFileSync } from "fs";
import { join } from "path";

/** The id of the build this server process is running, stamped into the HTML
 *  so an open tab can detect that a newer deploy is live and reload itself.
 *  Read once per process; BUILD_ID only changes when the image is rebuilt. */
let cached: string | null = null;

export function buildId(): string {
  if (cached) return cached;
  try {
    cached = readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim() || "dev";
  } catch {
    cached = "dev";
  }
  return cached;
}
