/**
 * MemoryStorageBackend compliance test — validates the reference
 * implementation against the standard test suite.
 */

import { describe } from "vitest";
import { MemoryStorageBackend } from "./storage.ts";
import { runStorageComplianceTests } from "../../kernel/storage.compliance-test.ts";

describe("MemoryStorageBackend", () => {
  runStorageComplianceTests(() => new MemoryStorageBackend());
});
