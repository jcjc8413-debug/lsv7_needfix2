/*
  # Create payment intents table for Ziina integration

  1. New Tables
    - `payment_intents`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users)
      - `plan_type` (text)
      - `auto_renew` (boolean)
      - `amount` (integer, amount in fils)
      - `status` (text)
      - `ziina_payment_intent_id` (text)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on `payment_intents` table
    - Add policy for users to read their own payment intents
    - Add policy for service role to manage all payment intents
*/

CREATE TABLE IF NOT EXISTS payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_type text NOT NULL,
  auto_renew boolean DEFAULT false,
  amount integer NOT NULL,
  status text DEFAULT 'pending',
  ziina_payment_intent_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE payment_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own payment intents"
  ON payment_intents
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all payment intents"
  ON payment_intents
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER update_payment_intents_updated_at
  BEFORE UPDATE ON payment_intents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();