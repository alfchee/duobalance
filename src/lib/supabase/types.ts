export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          balance_mode: string
          balance_updated_at: string | null
          created_at: string
          credit_limit: number | null
          currency: string
          display_order: number | null
          household_id: string
          id: string
          institution: string | null
          is_archived: boolean
          is_shared: boolean
          kind: string
          manual_balance: number | null
          name: string
          opening_balance: number
          owner_member_id: string | null
          updated_at: string
        }
        Insert: {
          balance_mode?: string
          balance_updated_at?: string | null
          created_at?: string
          credit_limit?: number | null
          currency: string
          display_order?: number | null
          household_id: string
          id?: string
          institution?: string | null
          is_archived?: boolean
          is_shared?: boolean
          kind: string
          manual_balance?: number | null
          name: string
          opening_balance?: number
          owner_member_id?: string | null
          updated_at?: string
        }
        Update: {
          balance_mode?: string
          balance_updated_at?: string | null
          created_at?: string
          credit_limit?: number | null
          currency?: string
          display_order?: number | null
          household_id?: string
          id?: string
          institution?: string | null
          is_archived?: boolean
          is_shared?: boolean
          kind?: string
          manual_balance?: number | null
          name?: string
          opening_balance?: number
          owner_member_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "accounts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_owner_member_id_fkey"
            columns: ["owner_member_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_instances: {
        Row: {
          amount: number
          bill_id: string
          created_at: string
          due_on: string
          household_id: string
          id: string
          is_paid: boolean
          paid_at: string | null
          paid_transaction_id: string | null
        }
        Insert: {
          amount: number
          bill_id: string
          created_at?: string
          due_on: string
          household_id: string
          id?: string
          is_paid?: boolean
          paid_at?: string | null
          paid_transaction_id?: string | null
        }
        Update: {
          amount?: number
          bill_id?: string
          created_at?: string
          due_on?: string
          household_id?: string
          id?: string
          is_paid?: boolean
          paid_at?: string | null
          paid_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bill_instances_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bill_instances_view"
            referencedColumns: ["bill_id"]
          },
          {
            foreignKeyName: "bill_instances_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_instances_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_instances_paid_transaction_id_fkey"
            columns: ["paid_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      bills: {
        Row: {
          account_id: string
          amount: number
          auto_pay: boolean
          category_id: string | null
          created_at: string
          currency: string
          frequency: Database["public"]["Enums"]["bill_frequency"]
          household_id: string
          id: string
          is_active: boolean
          name: string
          next_due_on: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          amount: number
          auto_pay?: boolean
          category_id?: string | null
          created_at?: string
          currency: string
          frequency: Database["public"]["Enums"]["bill_frequency"]
          household_id: string
          id?: string
          is_active?: boolean
          name: string
          next_due_on?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          amount?: number
          auto_pay?: boolean
          category_id?: string | null
          created_at?: string
          currency?: string
          frequency?: Database["public"]["Enums"]["bill_frequency"]
          household_id?: string
          id?: string
          is_active?: boolean
          name?: string
          next_due_on?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bills_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "bills_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "bills_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          amount: number
          category_id: string | null
          created_at: string
          currency: string
          household_id: string
          id: string
          is_active: boolean
          period: Database["public"]["Enums"]["budget_period"]
          starts_on: string
          updated_at: string
        }
        Insert: {
          amount: number
          category_id?: string | null
          created_at?: string
          currency: string
          household_id: string
          id?: string
          is_active?: boolean
          period: Database["public"]["Enums"]["budget_period"]
          starts_on: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category_id?: string | null
          created_at?: string
          currency?: string
          household_id?: string
          id?: string
          is_active?: boolean
          period?: Database["public"]["Enums"]["budget_period"]
          starts_on?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "budgets_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          color_hex: string | null
          created_at: string
          display_order: number
          household_id: string
          icon: string | null
          id: string
          is_archived: boolean
          is_default: boolean
          kind: string
          name: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          color_hex?: string | null
          created_at?: string
          display_order?: number
          household_id: string
          icon?: string | null
          id?: string
          is_archived?: boolean
          is_default?: boolean
          kind?: string
          name: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          color_hex?: string | null
          created_at?: string
          display_order?: number
          household_id?: string
          icon?: string | null
          id?: string
          is_archived?: boolean
          is_default?: boolean
          kind?: string
          name?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      categorization_rules: {
        Row: {
          account_id: string | null
          category_id: string
          created_at: string
          household_id: string
          id: string
          is_active: boolean
          match_pattern: string
          priority: number
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          category_id: string
          created_at?: string
          household_id: string
          id?: string
          is_active?: boolean
          match_pattern: string
          priority?: number
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          category_id?: string
          created_at?: string
          household_id?: string
          id?: string
          is_active?: boolean
          match_pattern?: string
          priority?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categorization_rules_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "categorization_rules_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categorization_rules_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categorization_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categorization_rules_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      country_defaults: {
        Row: {
          country: string
          locale: string
          timezone: string
        }
        Insert: {
          country: string
          locale: string
          timezone: string
        }
        Update: {
          country?: string
          locale?: string
          timezone?: string
        }
        Relationships: []
      }
      currencies: {
        Row: {
          code: string
          created_at: string
          is_enabled: boolean
          minor_unit: number
          name_en: string
          symbol: string | null
        }
        Insert: {
          code: string
          created_at?: string
          is_enabled?: boolean
          minor_unit?: number
          name_en: string
          symbol?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          is_enabled?: boolean
          minor_unit?: number
          name_en?: string
          symbol?: string | null
        }
        Relationships: []
      }
      fx_fetch_log: {
        Row: {
          error: string | null
          id: string
          inserted: number
          outcome: string
          ran_at: string
          rate_date: string
          skipped: number
          updated: number
        }
        Insert: {
          error?: string | null
          id?: string
          inserted?: number
          outcome: string
          ran_at?: string
          rate_date: string
          skipped?: number
          updated?: number
        }
        Update: {
          error?: string | null
          id?: string
          inserted?: number
          outcome?: string
          ran_at?: string
          rate_date?: string
          skipped?: number
          updated?: number
        }
        Relationships: []
      }
      fx_overrides: {
        Row: {
          code: string
          household_id: string
          note: string | null
          rate_date: string
          usd_rate: number
        }
        Insert: {
          code: string
          household_id: string
          note?: string | null
          rate_date: string
          usd_rate: number
        }
        Update: {
          code?: string
          household_id?: string
          note?: string | null
          rate_date?: string
          usd_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "fx_overrides_code_fkey"
            columns: ["code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "fx_overrides_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      fx_rates: {
        Row: {
          code: string
          fetched_at: string
          rate_date: string
          source: string
          usd_rate: number
        }
        Insert: {
          code: string
          fetched_at?: string
          rate_date: string
          source?: string
          usd_rate: number
        }
        Update: {
          code?: string
          fetched_at?: string
          rate_date?: string
          source?: string
          usd_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "fx_rates_code_fkey"
            columns: ["code"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      household_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          household_id: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["household_member_role"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          household_id: string
          id?: string
          invited_by: string
          role: Database["public"]["Enums"]["household_member_role"]
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          household_id?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["household_member_role"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_invites_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id"]
          },
        ]
      }
      household_members: {
        Row: {
          avatar_url: string | null
          color_hex: string | null
          display_name: string
          household_id: string
          id: string
          joined_at: string
          role: Database["public"]["Enums"]["household_member_role"]
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          color_hex?: string | null
          display_name: string
          household_id: string
          id?: string
          joined_at?: string
          role: Database["public"]["Enums"]["household_member_role"]
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          color_hex?: string | null
          display_name?: string
          household_id?: string
          id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["household_member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          base_currency: string
          country: string
          created_at: string
          id: string
          locale: string
          name: string
          timezone: string
          updated_at: string
        }
        Insert: {
          base_currency: string
          country: string
          created_at?: string
          id?: string
          locale: string
          name: string
          timezone: string
          updated_at?: string
        }
        Update: {
          base_currency?: string
          country?: string
          created_at?: string
          id?: string
          locale?: string
          name?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "households_base_currency_fkey"
            columns: ["base_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      import_batches: {
        Row: {
          created_at: string
          currency: string
          error_message: string | null
          file_hash: string
          file_name: string
          household_id: string
          id: string
          import_profile_id: string
          imported_at: string | null
          status: Database["public"]["Enums"]["import_batch_status"]
          total_amount: number
          transaction_count: number
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          currency: string
          error_message?: string | null
          file_hash: string
          file_name: string
          household_id: string
          id?: string
          import_profile_id: string
          imported_at?: string | null
          status?: Database["public"]["Enums"]["import_batch_status"]
          total_amount?: number
          transaction_count?: number
          uploaded_by: string
        }
        Update: {
          created_at?: string
          currency?: string
          error_message?: string | null
          file_hash?: string
          file_name?: string
          household_id?: string
          id?: string
          import_profile_id?: string
          imported_at?: string | null
          status?: Database["public"]["Enums"]["import_batch_status"]
          total_amount?: number
          transaction_count?: number
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "import_batches_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_batches_import_profile_id_fkey"
            columns: ["import_profile_id"]
            isOneToOne: false
            referencedRelation: "import_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_batches_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id"]
          },
        ]
      }
      import_profiles: {
        Row: {
          account_id: string
          amount_sign: string
          column_mapping: Json
          created_at: string
          date_format: string
          file_format: Database["public"]["Enums"]["import_file_format"]
          has_header_row: boolean
          household_id: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          account_id: string
          amount_sign?: string
          column_mapping: Json
          created_at?: string
          date_format?: string
          file_format: Database["public"]["Enums"]["import_file_format"]
          has_header_row?: boolean
          household_id: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          amount_sign?: string
          column_mapping?: Json
          created_at?: string
          date_format?: string
          file_format?: Database["public"]["Enums"]["import_file_format"]
          has_header_row?: boolean
          household_id?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_profiles_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "import_profiles_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_profiles_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_profiles_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_sends: {
        Row: {
          id: string
          sent_at: string
          user_id: string
        }
        Insert: {
          id?: string
          sent_at?: string
          user_id: string
        }
        Update: {
          id?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          account_id: string
          amount: number
          base_amount: number | null
          category_id: string | null
          created_at: string
          currency: string
          description: string
          entered_by: string
          fx_rate: number
          household_id: string
          id: string
          import_batch_id: string | null
          import_hash: string | null
          is_cleared: boolean
          is_pending_review: boolean
          merchant: string | null
          notes: string | null
          occurred_on: string
          receipt_url: string | null
          spent_by: string | null
          transfer_group_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          amount: number
          base_amount?: number | null
          category_id?: string | null
          created_at?: string
          currency: string
          description: string
          entered_by: string
          fx_rate?: number
          household_id: string
          id?: string
          import_batch_id?: string | null
          import_hash?: string | null
          is_cleared?: boolean
          is_pending_review?: boolean
          merchant?: string | null
          notes?: string | null
          occurred_on: string
          receipt_url?: string | null
          spent_by?: string | null
          transfer_group_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          amount?: number
          base_amount?: number | null
          category_id?: string | null
          created_at?: string
          currency?: string
          description?: string
          entered_by?: string
          fx_rate?: number
          household_id?: string
          id?: string
          import_batch_id?: string | null
          import_hash?: string | null
          is_cleared?: boolean
          is_pending_review?: boolean
          merchant?: string | null
          notes?: string | null
          occurred_on?: string
          receipt_url?: string | null
          spent_by?: string | null
          transfer_group_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "transactions_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_spent_by_fkey"
            columns: ["spent_by"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      account_balances: {
        Row: {
          account_id: string | null
          balance: number | null
          balance_mode: string | null
          balance_updated_at: string | null
          created_at: string | null
          credit_limit: number | null
          currency: string | null
          display_order: number | null
          household_id: string | null
          id: string | null
          institution: string | null
          is_archived: boolean | null
          is_shared: boolean | null
          kind: string | null
          last_transaction_at: string | null
          manual_balance: number | null
          name: string | null
          opening_balance: number | null
          owner_member_id: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "accounts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_owner_member_id_fkey"
            columns: ["owner_member_id"]
            isOneToOne: false
            referencedRelation: "household_members"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_instances_view: {
        Row: {
          account_id: string | null
          amount: number | null
          bill_id: string | null
          bill_name: string | null
          category_id: string | null
          currency: string | null
          due_date: string | null
          household_id: string | null
          id: string | null
          is_paid: boolean | null
          paid_at: string | null
          paid_transaction_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bill_instances_paid_transaction_id_fkey"
            columns: ["paid_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "bills_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "account_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "bills_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_status: {
        Row: {
          budget_id: string | null
          budgeted: number | null
          category_id: string | null
          currency: string | null
          household_id: string | null
          pct_used: number | null
          period: Database["public"]["Enums"]["budget_period"] | null
          remaining: number | null
          spent: number | null
        }
        Relationships: [
          {
            foreignKeyName: "budgets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "budgets_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_invite: { Args: { p_token: string }; Returns: string }
      assert_same_household: {
        Args: {
          p_actual_household_id: string
          p_error_msg: string
          p_expected_household_id: string
        }
        Returns: undefined
      }
      check_member_in_household: {
        Args: { p_household_id: string; p_member_id: string }
        Returns: undefined
      }
      create_household: {
        Args: {
          p_base_currency: string
          p_country: string
          p_display_name: string
          p_locale?: string
          p_name: string
          p_timezone?: string
        }
        Returns: string
      }
      create_transfer: {
        Args: {
          p_description: string
          p_from_account: string
          p_from_amount: number
          p_from_fx_rate: number
          p_household: string
          p_occurred_on: string
          p_to_account: string
          p_to_amount: number
          p_to_fx_rate: number
        }
        Returns: string
      }
      current_member: {
        Args: { household: string }
        Returns: {
          avatar_url: string | null
          color_hex: string | null
          display_name: string
          household_id: string
          id: string
          joined_at: string
          role: Database["public"]["Enums"]["household_member_role"]
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "household_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_member_id: { Args: { household: string }; Returns: string }
      delete_transfer: {
        Args: { p_transaction_id: string }
        Returns: undefined
      }
      fx_rate_on: {
        Args: {
          p_date: string
          p_from: string
          p_household: string
          p_to: string
        }
        Returns: number
      }
      fx_usd_rate: {
        Args: { p_code: string; p_date: string; p_household: string }
        Returns: number
      }
      is_member: { Args: { household: string }; Returns: boolean }
      is_owner: { Args: { household: string }; Returns: boolean }
      seed_default_categories: {
        Args: { p_household_id: string; p_locale: string }
        Returns: undefined
      }
      seed_expense_categories: {
        Args: { p_household_id: string; p_locale: string }
        Returns: undefined
      }
      seed_income_categories: {
        Args: { p_household_id: string; p_locale: string }
        Returns: undefined
      }
    }
    Enums: {
      bill_frequency: "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly"
      budget_period: "weekly" | "monthly" | "yearly"
      household_member_role: "owner" | "partner"
      import_batch_status: "pending" | "imported" | "failed" | "cancelled"
      import_file_format: "csv" | "ofx" | "qif"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      bill_frequency: ["weekly", "biweekly", "monthly", "quarterly", "yearly"],
      budget_period: ["weekly", "monthly", "yearly"],
      household_member_role: ["owner", "partner"],
      import_batch_status: ["pending", "imported", "failed", "cancelled"],
      import_file_format: ["csv", "ofx", "qif"],
    },
  },
} as const

