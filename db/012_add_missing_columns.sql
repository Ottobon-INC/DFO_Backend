-- Migration 012: Add missing columns for appointments and users
-- Run this in your Supabase SQL Editor.

-- Add specialization to users if not exists
ALTER TABLE sakhi_clinic_users
ADD COLUMN IF NOT EXISTS specialization TEXT;

-- Add cancellation_reason and cancelled_at to appointments if not exists
ALTER TABLE sakhi_clinic_appointments
ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
