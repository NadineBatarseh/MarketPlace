import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

// استخراج المتغيرات من ملف .env
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_KEY!;

// إنشاء العميل الذي سيتصل بقاعدة البيانات
export const supabase = createClient(supabaseUrl, supabaseKey);