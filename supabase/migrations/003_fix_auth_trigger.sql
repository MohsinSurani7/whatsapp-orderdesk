-- Fix: "Database error creating new user" on signup
-- Run this in Supabase → SQL Editor → Run

-- 1) Remove broken trigger (common cause of signup 500)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 2) Recreate profile helper with correct search_path
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email
  )
  ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        email = EXCLUDED.email;
  RETURN NEW;
END;
$$;

-- 3) Re-attach trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 4) Ensure service role / authenticated can work with profiles
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON TABLE public.profiles TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
