export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      access_codes: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          max_uses: number | null
          note: string
          status: Database["public"]["Enums"]["code_status"]
          uses: number
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          note?: string
          status?: Database["public"]["Enums"]["code_status"]
          uses?: number
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          note?: string
          status?: Database["public"]["Enums"]["code_status"]
          uses?: number
        }
        Relationships: [
          {
            foreignKeyName: "access_codes_created_by_profile"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      achievements: {
        Row: {
          category: string
          coin_reward: number
          color: string
          description: string
          description_ar: string
          icon: string
          id: string
          name: string
          name_ar: string
          rarity: string
          sort_order: number
          unlock_criteria: Json
          xp_reward: number
        }
        Insert: {
          category?: string
          coin_reward?: number
          color?: string
          description?: string
          description_ar?: string
          icon?: string
          id: string
          name: string
          name_ar: string
          rarity: string
          sort_order?: number
          unlock_criteria?: Json
          xp_reward?: number
        }
        Update: {
          category?: string
          coin_reward?: number
          color?: string
          description?: string
          description_ar?: string
          icon?: string
          id?: string
          name?: string
          name_ar?: string
          rarity?: string
          sort_order?: number
          unlock_criteria?: Json
          xp_reward?: number
        }
        Relationships: []
      }
      activity_log: {
        Row: {
          created_at: string
          event_type: string
          id: string
          is_global: boolean
          message: string
          message_ar: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          is_global?: boolean
          message: string
          message_ar: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          is_global?: boolean
          message?: string
          message_ar?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_log: {
        Row: {
          action: string
          actor_id: string | null
          category: string
          created_at: string
          detail: string
          id: string
          new_value: string | null
          old_value: string | null
          target: string
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          category: string
          created_at?: string
          detail?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          target: string
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          category?: string
          created_at?: string
          detail?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          target?: string
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_log_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          pinned: boolean
          scheduled_at: string | null
          title: string
        }
        Insert: {
          body?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          pinned?: boolean
          scheduled_at?: string | null
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          pinned?: boolean
          scheduled_at?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
        Row: {
          id: boolean
          owner_email: string
        }
        Insert: {
          id?: boolean
          owner_email: string
        }
        Update: {
          id?: boolean
          owner_email?: string
        }
        Relationships: []
      }
      board_game_moves: {
        Row: {
          created_at: string
          id: string
          move: Json | null
          move_number: number
          resulting_state: Json | null
          room_id: string
          seat_index: number
        }
        Insert: {
          created_at?: string
          id?: string
          move?: Json | null
          move_number: number
          resulting_state?: Json | null
          room_id: string
          seat_index: number
        }
        Update: {
          created_at?: string
          id?: string
          move?: Json | null
          move_number?: number
          resulting_state?: Json | null
          room_id?: string
          seat_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "board_game_moves_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "board_game_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      board_game_messages: {
        Row: {
          body: string
          client_message_id: string
          created_at: string
          id: string
          room_id: string
          sender_id: string
        }
        Insert: {
          body: string
          client_message_id: string
          created_at?: string
          id?: string
          room_id: string
          sender_id: string
        }
        Update: {
          body?: string
          client_message_id?: string
          created_at?: string
          id?: string
          room_id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_game_messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "board_game_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_game_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      board_game_players: {
        Row: {
          ai_difficulty: string | null
          consecutive_missed_turns: number
          eliminated_at: string | null
          elimination_reason: string | null
          final_rank: number | null
          final_score: number | null
          id: string
          is_ai: boolean
          is_connected: boolean
          is_ready: boolean
          joined_at: string
          last_action_at: string | null
          last_heartbeat_at: string
          left_at: string | null
          room_id: string
          seat_index: number | null
          user_id: string | null
        }
        Insert: {
          ai_difficulty?: string | null
          consecutive_missed_turns?: number
          eliminated_at?: string | null
          elimination_reason?: string | null
          final_rank?: number | null
          final_score?: number | null
          id?: string
          is_ai?: boolean
          is_connected?: boolean
          is_ready?: boolean
          joined_at?: string
          last_action_at?: string | null
          last_heartbeat_at?: string
          left_at?: string | null
          room_id: string
          seat_index?: number | null
          user_id?: string | null
        }
        Update: {
          ai_difficulty?: string | null
          consecutive_missed_turns?: number
          eliminated_at?: string | null
          elimination_reason?: string | null
          final_rank?: number | null
          final_score?: number | null
          id?: string
          is_ai?: boolean
          is_connected?: boolean
          is_ready?: boolean
          joined_at?: string
          last_action_at?: string | null
          last_heartbeat_at?: string
          left_at?: string | null
          room_id?: string
          seat_index?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "board_game_players_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "board_game_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_game_players_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      board_game_rooms: {
        Row: {
          allow_spectators: boolean
          completed_at: string | null
          created_at: string
          game_id: string
          host_id: string | null
          id: string
          join_code: string | null
          max_players: number
          min_players: number
          rewards_granted_at: string | null
          started_at: string | null
          status: string
          turn_deadline_at: string | null
          turn_seat_index: number | null
          turn_started_at: string | null
          turn_timer_seconds: number
        }
        Insert: {
          allow_spectators?: boolean
          completed_at?: string | null
          created_at?: string
          game_id: string
          host_id?: string | null
          id?: string
          join_code?: string | null
          max_players?: number
          min_players?: number
          rewards_granted_at?: string | null
          started_at?: string | null
          status?: string
          turn_deadline_at?: string | null
          turn_seat_index?: number | null
          turn_started_at?: string | null
          turn_timer_seconds?: number
        }
        Update: {
          allow_spectators?: boolean
          completed_at?: string | null
          created_at?: string
          game_id?: string
          host_id?: string | null
          id?: string
          join_code?: string | null
          max_players?: number
          min_players?: number
          rewards_granted_at?: string | null
          started_at?: string | null
          status?: string
          turn_deadline_at?: string | null
          turn_seat_index?: number | null
          turn_started_at?: string | null
          turn_timer_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "board_game_rooms_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_game_rooms_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      board_game_spectators: {
        Row: {
          joined_at: string
          room_id: string
          user_id: string
        }
        Insert: {
          joined_at?: string
          room_id: string
          user_id: string
        }
        Update: {
          joined_at?: string
          room_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_game_spectators_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "board_game_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_game_spectators_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      board_game_state: {
        Row: {
          room_id: string
          state: Json
          updated_at: string
          version: number
        }
        Insert: {
          room_id: string
          state: Json
          updated_at?: string
          version?: number
        }
        Update: {
          room_id?: string
          state?: Json
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "board_game_state_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: true
            referencedRelation: "board_game_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name_ar: string
          name_en: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name_ar: string
          name_en: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name_ar?: string
          name_en?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      challenge_participants: {
        Row: {
          challenge_id: string
          id: string
          joined_at: string
          questions_completed: number
          rewarded: boolean
          score: number
          user_id: string
        }
        Insert: {
          challenge_id: string
          id?: string
          joined_at?: string
          questions_completed?: number
          rewarded?: boolean
          score?: number
          user_id: string
        }
        Update: {
          challenge_id?: string
          id?: string
          joined_at?: string
          questions_completed?: number
          rewarded?: boolean
          score?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_participants_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_prizes: {
        Row: {
          challenge_id: string
          id: string
          prize: string
          prize_ar: string
          rank_label: string
          rank_label_ar: string
          sort_order: number
        }
        Insert: {
          challenge_id: string
          id?: string
          prize: string
          prize_ar: string
          rank_label: string
          rank_label_ar: string
          sort_order?: number
        }
        Update: {
          challenge_id?: string
          id?: string
          prize?: string
          prize_ar?: string
          rank_label?: string
          rank_label_ar?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "challenge_prizes_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      challenges: {
        Row: {
          coin_reward: number
          ends_at: string
          game_id: string | null
          id: string
          period_type: string
          question_count: number
          starts_at: string
          title: string
          title_ar: string
          xp_reward: number
        }
        Insert: {
          coin_reward?: number
          ends_at: string
          game_id?: string | null
          id?: string
          period_type: string
          question_count?: number
          starts_at: string
          title: string
          title_ar: string
          xp_reward?: number
        }
        Update: {
          coin_reward?: number
          ends_at?: string
          game_id?: string | null
          id?: string
          period_type?: string
          question_count?: number
          starts_at?: string
          title?: string
          title_ar?: string
          xp_reward?: number
        }
        Relationships: [
          {
            foreignKeyName: "challenges_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      coin_ledger: {
        Row: {
          created_at: string
          created_by: string | null
          delta: number
          id: string
          reason: string
          ref_id: string | null
          source: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delta: number
          id?: string
          reason: string
          ref_id?: string | null
          source: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delta?: number
          id?: string
          reason?: string
          ref_id?: string | null
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coin_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coin_reward_config: {
        Row: {
          amount: number
          key: string
          label: string
          label_ar: string
          updated_at: string
        }
        Insert: {
          amount?: number
          key: string
          label?: string
          label_ar?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          key?: string
          label?: string
          label_ar?: string
          updated_at?: string
        }
        Relationships: []
      }
      cosmetic_items: {
        Row: {
          id: string
          label: string
          label_ar: string
          description: string
          description_ar: string
          icon: string
          rarity: string
          price_coins: number | null
          is_available: boolean
          seasonal_start: string | null
          seasonal_end: string | null
          sort_order: number
          style: Json
          type: string
          unlock_criteria: Json
          media_type: string
          image_url: string | null
          video_url: string | null
          poster_url: string | null
          is_animated: boolean
        }
        Insert: {
          id: string
          label: string
          label_ar: string
          description?: string
          description_ar?: string
          icon?: string
          rarity?: string
          price_coins?: number | null
          is_available?: boolean
          seasonal_start?: string | null
          seasonal_end?: string | null
          sort_order?: number
          style?: Json
          type: string
          unlock_criteria?: Json
          media_type?: string
          image_url?: string | null
          video_url?: string | null
          poster_url?: string | null
          is_animated?: boolean
        }
        Update: {
          id?: string
          label?: string
          label_ar?: string
          description?: string
          description_ar?: string
          icon?: string
          rarity?: string
          price_coins?: number | null
          is_available?: boolean
          seasonal_start?: string | null
          seasonal_end?: string | null
          sort_order?: number
          style?: Json
          type?: string
          unlock_criteria?: Json
          media_type?: string
          image_url?: string | null
          video_url?: string | null
          poster_url?: string | null
          is_animated?: boolean
        }
        Relationships: []
      }
      daily_reward_claims: {
        Row: {
          claim_date: string
          coins_awarded: number
          created_at: string
          id: string
          streak_day: number
          user_id: string
          xp_awarded: number
        }
        Insert: {
          claim_date: string
          coins_awarded?: number
          created_at?: string
          id?: string
          streak_day: number
          user_id: string
          xp_awarded: number
        }
        Update: {
          claim_date?: string
          coins_awarded?: number
          created_at?: string
          id?: string
          streak_day?: number
          user_id?: string
          xp_awarded?: number
        }
        Relationships: [
          {
            foreignKeyName: "daily_reward_claims_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      emoji_puzzles: {
        Row: {
          category: string
          correct_index: number
          created_at: string
          difficulty: string
          emoji: string
          id: string
          is_active: boolean
          options_ar: Json
          options_en: Json
        }
        Insert: {
          category?: string
          correct_index: number
          created_at?: string
          difficulty?: string
          emoji: string
          id?: string
          is_active?: boolean
          options_ar: Json
          options_en: Json
        }
        Update: {
          category?: string
          correct_index?: number
          created_at?: string
          difficulty?: string
          emoji?: string
          id?: string
          is_active?: boolean
          options_ar?: Json
          options_en?: Json
        }
        Relationships: []
      }
      friend_requests: {
        Row: {
          created_at: string
          id: string
          recipient_id: string
          requester_id: string
          responded_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          recipient_id: string
          requester_id: string
          responded_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          recipient_id?: string
          requester_id?: string
          responded_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "friend_requests_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friend_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friendships: {
        Row: {
          created_at: string
          id: string
          user_a: string
          user_b: string
        }
        Insert: {
          created_at?: string
          id?: string
          user_a: string
          user_b: string
        }
        Update: {
          created_at?: string
          id?: string
          user_a?: string
          user_b?: string
        }
        Relationships: [
          {
            foreignKeyName: "friendships_user_a_fkey"
            columns: ["user_a"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_user_b_fkey"
            columns: ["user_b"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_rooms: {
        Row: {
          completed_at: string | null
          created_at: string
          current_round: number
          game_id: string
          host_id: string | null
          id: string
          join_code: string | null
          max_players: number
          min_players: number
          mode: string
          round_count: number
          started_at: string | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          current_round?: number
          game_id: string
          host_id?: string | null
          id?: string
          join_code?: string | null
          max_players?: number
          min_players?: number
          mode?: string
          round_count?: number
          started_at?: string | null
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          current_round?: number
          game_id?: string
          host_id?: string | null
          id?: string
          join_code?: string | null
          max_players?: number
          min_players?: number
          mode?: string
          round_count?: number
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_rooms_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_rooms_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_room_players: {
        Row: {
          final_rank: number | null
          final_score: number
          id: string
          is_host: boolean
          is_ready: boolean
          joined_at: string
          last_heartbeat_at: string
          left_at: string | null
          room_id: string
          session_id: string | null
          user_id: string
        }
        Insert: {
          final_rank?: number | null
          final_score?: number
          id?: string
          is_host?: boolean
          is_ready?: boolean
          joined_at?: string
          last_heartbeat_at?: string
          left_at?: string | null
          room_id: string
          session_id?: string | null
          user_id: string
        }
        Update: {
          final_rank?: number | null
          final_score?: number
          id?: string
          is_host?: boolean
          is_ready?: boolean
          joined_at?: string
          last_heartbeat_at?: string
          left_at?: string | null
          room_id?: string
          session_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_room_players_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "match_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_room_players_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_room_players_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "game_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      match_rounds: {
        Row: {
          created_at: string
          duration_ms: number
          ends_at: string
          id: string
          payload: Json
          revealed_at: string | null
          room_id: string
          round_number: number
          starts_at: string
        }
        Insert: {
          created_at?: string
          duration_ms: number
          ends_at: string
          id?: string
          payload?: Json
          revealed_at?: string | null
          room_id: string
          round_number: number
          starts_at: string
        }
        Update: {
          created_at?: string
          duration_ms?: number
          ends_at?: string
          id?: string
          payload?: Json
          revealed_at?: string | null
          room_id?: string
          round_number?: number
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_rounds_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "match_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      match_round_answers: {
        Row: {
          answer: Json | null
          answered_at: string | null
          id: string
          is_correct: boolean
          points_awarded: number
          round_id: string
          time_taken_ms: number | null
          updated_at: string
          user_id: string
          wrong_attempts: number
        }
        Insert: {
          answer?: Json | null
          answered_at?: string | null
          id?: string
          is_correct?: boolean
          points_awarded?: number
          round_id: string
          time_taken_ms?: number | null
          updated_at?: string
          user_id: string
          wrong_attempts?: number
        }
        Update: {
          answer?: Json | null
          answered_at?: string | null
          id?: string
          is_correct?: boolean
          points_awarded?: number
          round_id?: string
          time_taken_ms?: number | null
          updated_at?: string
          user_id?: string
          wrong_attempts?: number
        }
        Relationships: [
          {
            foreignKeyName: "match_round_answers_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "match_rounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_round_answers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_round_secrets: {
        Row: {
          round_id: string
          secret: Json
        }
        Insert: {
          round_id: string
          secret: Json
        }
        Update: {
          round_id?: string
          secret?: Json
        }
        Relationships: [
          {
            foreignKeyName: "match_round_secrets_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: true
            referencedRelation: "match_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      game_sessions: {
        Row: {
          combo_current: number
          combo_max: number
          completed_at: string | null
          context: string
          context_ref_id: string | null
          game_id: string
          id: string
          moves: number | null
          questions_correct: number
          questions_total: number
          score: number
          started_at: string
          status: string
          time_left_seconds: number | null
          user_id: string
          xp_awarded: number
        }
        Insert: {
          combo_current?: number
          combo_max?: number
          completed_at?: string | null
          context?: string
          context_ref_id?: string | null
          game_id: string
          id?: string
          moves?: number | null
          questions_correct?: number
          questions_total?: number
          score?: number
          started_at?: string
          status?: string
          time_left_seconds?: number | null
          user_id: string
          xp_awarded?: number
        }
        Update: {
          combo_current?: number
          combo_max?: number
          completed_at?: string | null
          context?: string
          context_ref_id?: string | null
          game_id?: string
          id?: string
          moves?: number | null
          questions_correct?: number
          questions_total?: number
          score?: number
          started_at?: string
          status?: string
          time_left_seconds?: number | null
          user_id?: string
          xp_awarded?: number
        }
        Relationships: [
          {
            foreignKeyName: "game_sessions_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          accent_color: string
          base_xp: number
          category: string
          cover_image_url: string | null
          icon_key: string
          id: string
          is_active: boolean
          is_coming_soon: boolean
          is_featured: boolean
          is_multiplayer: boolean
          is_new: boolean
          name: string
          name_ar: string
          sort_order: number
          tag: string | null
          tagline: string
          tagline_ar: string
          target_screen: string
          thumbnail_image_url: string | null
          world: string | null
        }
        Insert: {
          accent_color?: string
          base_xp?: number
          category: string
          cover_image_url?: string | null
          icon_key?: string
          id: string
          is_active?: boolean
          is_coming_soon?: boolean
          is_featured?: boolean
          is_multiplayer?: boolean
          is_new?: boolean
          name: string
          name_ar: string
          sort_order?: number
          tag?: string | null
          tagline?: string
          tagline_ar?: string
          target_screen: string
          thumbnail_image_url?: string | null
          world?: string | null
        }
        Update: {
          accent_color?: string
          base_xp?: number
          category?: string
          cover_image_url?: string | null
          icon_key?: string
          id?: string
          is_active?: boolean
          is_coming_soon?: boolean
          is_featured?: boolean
          is_multiplayer?: boolean
          is_new?: boolean
          name?: string
          name_ar?: string
          sort_order?: number
          tag?: string | null
          tagline?: string
          tagline_ar?: string
          target_screen?: string
          thumbnail_image_url?: string | null
          world?: string | null
        }
        Relationships: []
      }
      user_favorite_games: {
        Row: {
          created_at: string
          game_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          game_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          game_id?: string
          user_id?: string
        }
        Relationships: []
      }
      global_events: {
        Row: {
          ends_at: string
          id: string
          is_active: boolean
          multiplier: number
          starts_at: string
          type: string
        }
        Insert: {
          ends_at: string
          id?: string
          is_active?: boolean
          multiplier?: number
          starts_at?: string
          type: string
        }
        Update: {
          ends_at?: string
          id?: string
          is_active?: boolean
          multiplier?: number
          starts_at?: string
          type?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          body_ar: string | null
          created_at: string
          data: Json
          id: string
          is_read: boolean
          title: string
          title_ar: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          body_ar?: string | null
          created_at?: string
          data?: Json
          id?: string
          is_read?: boolean
          title: string
          title_ar: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          body_ar?: string | null
          created_at?: string
          data?: Json
          id?: string
          is_read?: boolean
          title?: string
          title_ar?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          access_code_id: string | null
          avatar_url: string | null
          bio: string | null
          branch_id: string | null
          coins: number
          created_at: string
          custom_title: string | null
          custom_title_ar: string | null
          email: string
          equipped_banner_id: string | null
          equipped_frame_id: string | null
          equipped_title_id: string | null
          equipped_decoration_id: string | null
          header_url: string | null
          id: string
          is_online: boolean
          last_active_week: string | null
          last_claimed_reward_date: string | null
          last_login_at: string | null
          level: number
          login_count: number
          pinned_badge_ids: string[]
          role: Database["public"]["Enums"]["user_role"]
          status: Database["public"]["Enums"]["user_status"]
          streak_count: number
          updated_at: string
          username: string
          weekly_streak_count: number
          xp: number
        }
        Insert: {
          access_code_id?: string | null
          avatar_url?: string | null
          bio?: string | null
          branch_id?: string | null
          coins?: number
          created_at?: string
          custom_title?: string | null
          custom_title_ar?: string | null
          email: string
          equipped_banner_id?: string | null
          equipped_frame_id?: string | null
          equipped_title_id?: string | null
          equipped_decoration_id?: string | null
          header_url?: string | null
          id: string
          is_online?: boolean
          last_active_week?: string | null
          last_claimed_reward_date?: string | null
          last_login_at?: string | null
          level?: number
          login_count?: number
          pinned_badge_ids?: string[]
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["user_status"]
          streak_count?: number
          updated_at?: string
          username: string
          weekly_streak_count?: number
          xp?: number
        }
        Update: {
          access_code_id?: string | null
          avatar_url?: string | null
          bio?: string | null
          branch_id?: string | null
          coins?: number
          created_at?: string
          custom_title?: string | null
          custom_title_ar?: string | null
          email?: string
          equipped_banner_id?: string | null
          equipped_frame_id?: string | null
          equipped_title_id?: string | null
          equipped_decoration_id?: string | null
          header_url?: string | null
          id?: string
          is_online?: boolean
          last_active_week?: string | null
          last_claimed_reward_date?: string | null
          last_login_at?: string | null
          level?: number
          login_count?: number
          pinned_badge_ids?: string[]
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["user_status"]
          streak_count?: number
          updated_at?: string
          username?: string
          weekly_streak_count?: number
          xp?: number
        }
        Relationships: [
          {
            foreignKeyName: "profiles_access_code_id_fkey"
            columns: ["access_code_id"]
            isOneToOne: false
            referencedRelation: "access_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      question_responses: {
        Row: {
          answered_at: string
          id: string
          is_correct: boolean
          points_awarded: number
          question_id: string
          selected_option: number
          session_id: string
          time_taken_ms: number | null
        }
        Insert: {
          answered_at?: string
          id?: string
          is_correct: boolean
          points_awarded?: number
          question_id: string
          selected_option: number
          session_id: string
          time_taken_ms?: number | null
        }
        Update: {
          answered_at?: string
          id?: string
          is_correct?: boolean
          points_awarded?: number
          question_id?: string
          selected_option?: number
          session_id?: string
          time_taken_ms?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "question_responses_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_responses_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "game_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      questions: {
        Row: {
          correct_option_index: number
          created_at: string
          difficulty: string
          game_id: string
          id: string
          options: Json
          options_ar: Json
          question_text: string
          question_text_ar: string
          sort_order: number
        }
        Insert: {
          correct_option_index: number
          created_at?: string
          difficulty?: string
          game_id: string
          id?: string
          options: Json
          options_ar: Json
          question_text: string
          question_text_ar: string
          sort_order?: number
        }
        Update: {
          correct_option_index?: number
          created_at?: string
          difficulty?: string
          game_id?: string
          id?: string
          options?: Json
          options_ar?: Json
          question_text?: string
          question_text_ar?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "questions_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      season_pass_nodes: {
        Row: {
          icon: string
          id: string
          is_final: boolean
          level: number
          reward_amount: number | null
          reward_label: string
          reward_label_ar: string
          reward_ref_id: string | null
          reward_type: string
          season_id: string
        }
        Insert: {
          icon?: string
          id?: string
          is_final?: boolean
          level: number
          reward_amount?: number | null
          reward_label: string
          reward_label_ar: string
          reward_ref_id?: string | null
          reward_type: string
          season_id: string
        }
        Update: {
          icon?: string
          id?: string
          is_final?: boolean
          level?: number
          reward_amount?: number | null
          reward_label?: string
          reward_label_ar?: string
          reward_ref_id?: string | null
          reward_type?: string
          season_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "season_pass_nodes_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      seasons: {
        Row: {
          ended_at: string | null
          ends_at: string
          id: string
          is_active: boolean
          name: string
          name_ar: string
          starts_at: string
        }
        Insert: {
          ended_at?: string | null
          ends_at: string
          id?: string
          is_active?: boolean
          name: string
          name_ar: string
          starts_at: string
        }
        Update: {
          ended_at?: string | null
          ends_at?: string
          id?: string
          is_active?: boolean
          name?: string
          name_ar?: string
          starts_at?: string
        }
        Relationships: []
      }
      tournament_matches: {
        Row: {
          completed_at: string | null
          id: string
          match_order: number
          participant1_id: string | null
          participant2_id: string | null
          round_id: string
          scheduled_at: string | null
          score1: number | null
          score2: number | null
          winner_id: string | null
        }
        Insert: {
          completed_at?: string | null
          id?: string
          match_order: number
          participant1_id?: string | null
          participant2_id?: string | null
          round_id: string
          scheduled_at?: string | null
          score1?: number | null
          score2?: number | null
          winner_id?: string | null
        }
        Update: {
          completed_at?: string | null
          id?: string
          match_order?: number
          participant1_id?: string | null
          participant2_id?: string | null
          round_id?: string
          scheduled_at?: string | null
          score1?: number | null
          score2?: number | null
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tournament_matches_participant1_id_fkey"
            columns: ["participant1_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_matches_participant2_id_fkey"
            columns: ["participant2_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_matches_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "tournament_rounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_matches_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_participants: {
        Row: {
          id: string
          registered_at: string
          seed: number | null
          tournament_id: string
          user_id: string
        }
        Insert: {
          id?: string
          registered_at?: string
          seed?: number | null
          tournament_id: string
          user_id: string
        }
        Update: {
          id?: string
          registered_at?: string
          seed?: number | null
          tournament_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_participants_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_prizes: {
        Row: {
          id: string
          prize: string
          prize_ar: string
          rank_label: string
          rank_label_ar: string
          sort_order: number
          tournament_id: string
        }
        Insert: {
          id?: string
          prize: string
          prize_ar: string
          rank_label: string
          rank_label_ar: string
          sort_order?: number
          tournament_id: string
        }
        Update: {
          id?: string
          prize?: string
          prize_ar?: string
          rank_label?: string
          rank_label_ar?: string
          sort_order?: number
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_prizes_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_rounds: {
        Row: {
          ends_at: string | null
          id: string
          name: string
          name_ar: string
          round_order: number
          starts_at: string | null
          status: string
          tournament_id: string
        }
        Insert: {
          ends_at?: string | null
          id?: string
          name: string
          name_ar: string
          round_order: number
          starts_at?: string | null
          status?: string
          tournament_id: string
        }
        Update: {
          ends_at?: string | null
          id?: string
          name?: string
          name_ar?: string
          round_order?: number
          starts_at?: string | null
          status?: string
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_rounds_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournaments: {
        Row: {
          created_at: string
          ends_at: string | null
          id: string
          name: string
          name_ar: string
          qualification_rule: string
          qualification_rule_ar: string
          starts_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          id?: string
          name: string
          name_ar: string
          qualification_rule?: string
          qualification_rule_ar?: string
          starts_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          id?: string
          name?: string
          name_ar?: string
          qualification_rule?: string
          qualification_rule_ar?: string
          starts_at?: string | null
          status?: string
        }
        Relationships: []
      }
      user_achievements: {
        Row: {
          achievement_id: string
          unlocked_at: string
          user_id: string
        }
        Insert: {
          achievement_id: string
          unlocked_at?: string
          user_id: string
        }
        Update: {
          achievement_id?: string
          unlocked_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_achievements_achievement_id_fkey"
            columns: ["achievement_id"]
            isOneToOne: false
            referencedRelation: "achievements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_achievements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_cosmetic_unlocks: {
        Row: {
          item_id: string
          unlocked_at: string
          user_id: string
        }
        Insert: {
          item_id: string
          unlocked_at?: string
          user_id: string
        }
        Update: {
          item_id?: string
          unlocked_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_cosmetic_unlocks_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "cosmetic_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_cosmetic_unlocks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_game_stats: {
        Row: {
          best_score: number
          best_streak: number
          current_streak: number
          fastest_time_ms: number | null
          game_id: string
          games_played: number
          last_played_at: string | null
          total_correct: number
          total_questions: number
          updated_at: string
          user_id: string
          wins: number
        }
        Insert: {
          best_score?: number
          best_streak?: number
          current_streak?: number
          fastest_time_ms?: number | null
          game_id: string
          games_played?: number
          last_played_at?: string | null
          total_correct?: number
          total_questions?: number
          updated_at?: string
          user_id: string
          wins?: number
        }
        Update: {
          best_score?: number
          best_streak?: number
          current_streak?: number
          fastest_time_ms?: number | null
          game_id?: string
          games_played?: number
          last_played_at?: string | null
          total_correct?: number
          total_questions?: number
          updated_at?: string
          user_id?: string
          wins?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_game_stats_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_game_stats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_season_claims: {
        Row: {
          claimed_at: string
          node_id: string
          user_id: string
        }
        Insert: {
          claimed_at?: string
          node_id: string
          user_id: string
        }
        Update: {
          claimed_at?: string
          node_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_season_claims_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "season_pass_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_season_claims_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_season_progress: {
        Row: {
          current_level: number
          season_id: string
          season_xp: number
          user_id: string
        }
        Insert: {
          current_level?: number
          season_id: string
          season_xp?: number
          user_id: string
        }
        Update: {
          current_level?: number
          season_id?: string
          season_xp?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_season_progress_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_season_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      xp_ledger: {
        Row: {
          created_at: string
          created_by: string | null
          delta: number
          id: string
          reason: string
          ref_id: string | null
          source: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delta: number
          id?: string
          reason?: string
          ref_id?: string | null
          source: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delta?: number
          id?: string
          reason?: string
          ref_id?: string | null
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "xp_ledger_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "xp_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      blocks: {
        Row: {
          id: string
          blocker_id: string
          blocked_id: string
          created_at: string
        }
        Insert: {
          id?: string
          blocker_id: string
          blocked_id: string
          created_at?: string
        }
        Update: {
          id?: string
          blocker_id?: string
          blocked_id?: string
          created_at?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          id: string
          reporter_id: string
          reported_user_id: string
          conversation_id: string | null
          reason: string
          message_snapshot: Json
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          reporter_id: string
          reported_user_id: string
          conversation_id?: string | null
          reason: string
          message_snapshot?: Json
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          reporter_id?: string
          reported_user_id?: string
          conversation_id?: string | null
          reason?: string
          message_snapshot?: Json
          status?: string
          created_at?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          id: string
          user_a: string
          user_b: string
          created_at: string
          last_message_at: string | null
        }
        Insert: {
          id?: string
          user_a: string
          user_b: string
          created_at?: string
          last_message_at?: string | null
        }
        Update: {
          id?: string
          user_a?: string
          user_b?: string
          created_at?: string
          last_message_at?: string | null
        }
        Relationships: []
      }
      conversation_participants: {
        Row: {
          conversation_id: string
          user_id: string
          last_read_at: string | null
          is_viewing: boolean
          last_heartbeat_at: string | null
          draft_text: string | null
        }
        Insert: {
          conversation_id: string
          user_id: string
          last_read_at?: string | null
          is_viewing?: boolean
          last_heartbeat_at?: string | null
          draft_text?: string | null
        }
        Update: {
          conversation_id?: string
          user_id?: string
          last_read_at?: string | null
          is_viewing?: boolean
          last_heartbeat_at?: string | null
          draft_text?: string | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          id: string
          conversation_id: string
          sender_id: string
          body: string
          client_message_id: string
          source: string
          created_at: string
          delivered_at: string
          read_at: string | null
          is_saved: boolean
          saved_at: string | null
          saved_by: string | null
        }
        Insert: {
          id?: string
          conversation_id: string
          sender_id: string
          body: string
          client_message_id: string
          source?: string
          created_at?: string
          delivered_at?: string
          read_at?: string | null
          is_saved?: boolean
          saved_at?: string | null
          saved_by?: string | null
        }
        Update: {
          id?: string
          conversation_id?: string
          sender_id?: string
          body?: string
          client_message_id?: string
          source?: string
          created_at?: string
          delivered_at?: string
          read_at?: string | null
          is_saved?: boolean
          saved_at?: string | null
          saved_by?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          id: string
          user_id: string
          endpoint: string
          p256dh: string
          auth: string
          user_agent: string | null
          created_at: string
          last_seen_at: string
        }
        Insert: {
          id?: string
          user_id: string
          endpoint: string
          p256dh: string
          auth: string
          user_agent?: string | null
          created_at?: string
          last_seen_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          endpoint?: string
          p256dh?: string
          auth?: string
          user_agent?: string | null
          created_at?: string
          last_seen_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      // Loose on purpose (no per-RPC Args/Returns) — this project calls
      // ~50 RPCs and hand-typing each one isn't worth the maintenance
      // burden. The shape below is the minimum that satisfies
      // postgrest-js's GenericSchema['Functions'] constraint
      // (Record<string, { Args; Returns; SetofOptions? }>); without it,
      // the whole Database generic fails to structurally match
      // GenericSchema and EVERY .from()/.rpc() call across the app
      // silently degrades to `never`/`undefined` argument types — that
      // was the root cause of the ~380 pre-existing `tsc -b` errors
      // (which blocked `npm run build`, since that script runs `tsc -b`
      // before `vite build`). supabase.rpc(name, args) still type-checks
      // for any function name/args; callers that need a typed return
      // value cast the result themselves, same as before.
      [key: string]: {
        Args: Record<string, unknown>
        Returns: unknown
      }
    }
    Enums: {
      code_status: "active" | "disabled"
      user_role: "player" | "owner"
      user_status: "active" | "suspended"
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
  public: {
    Enums: {
      code_status: ["active", "disabled"],
      user_role: ["player", "owner"],
      user_status: ["active", "suspended"],
    },
  },
} as const
