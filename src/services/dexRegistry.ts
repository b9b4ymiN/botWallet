import { PROGRAM_ACCOUNTS_DEX } from "../constants";

export function getAllDexProgramsSet(): Set<string> {
  return new Set<string>(Object.values(PROGRAM_ACCOUNTS_DEX).flat());
}

export function getDexName(programId: string): string {
  for (const [dex, addresses] of Object.entries(PROGRAM_ACCOUNTS_DEX)) {
    if (addresses.includes(programId)) return dex;
  }
  return "Unknown DEX";
}

