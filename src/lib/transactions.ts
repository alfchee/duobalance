import type { Database } from "@/lib/supabase/types";

type TransactionsTable = Database["public"]["Tables"]["transactions"];

export type Transaction = TransactionsTable["Row"];
export type TransactionInsert = Omit<TransactionsTable["Insert"], "base_amount">;
export type TransactionUpdate = Omit<TransactionsTable["Update"], "base_amount">;

type Assert<T extends true> = T;
export type TransactionInsertExcludesBaseAmount = Assert<
  "base_amount" extends keyof TransactionInsert ? false : true
>;
export type TransactionUpdateExcludesBaseAmount = Assert<
  "base_amount" extends keyof TransactionUpdate ? false : true
>;
