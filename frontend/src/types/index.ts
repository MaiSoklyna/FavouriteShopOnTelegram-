// ── Auth ───────────────────────────────────────────────────────

export type UserRole = "user" | "merchant_admin" | "super_admin";
export type AdminDisplayRole = "super_admin" | "merchant";

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  role: AdminDisplayRole;
  merchant_id?: number | null;
  merchant_name?: string;
}

export interface TelegramUser {
  id: string;
  telegram_id: number;
  name: string;
  avatar_url?: string | null;
}

export interface AuthResponse {
  access_token: string;
  expires_in: number;
  user: AdminUser | TelegramUser;
}

// ── Merchant ───────────────────────────────────────────────────

export interface Merchant {
  id: number;
  name: string;
  slug: string;
  owner_name: string;
  email: string;
  phone?: string;
  tagline?: string;
  description?: string;
  icon_emoji?: string;
  accent_color?: string;
  plan: string;
  status: string;
  fb_page?: string;
  instagram?: string;
  logo_url?: string | null;
  is_featured?: boolean;
  telegram_group_id?: number | null;
  product_count?: number;
  order_count?: number;
  created_at?: string;
}

// ── Product ────────────────────────────────────────────────────

export interface Product {
  id: number;
  name: string;
  slug: string;
  description?: string;
  merchant_id: number;
  merchant_name?: string;
  category_id?: number | null;
  category_name?: string;
  base_price: number;
  compare_price?: number | null;
  stock: number;
  sku?: string;
  weight?: string;
  icon_emoji?: string;
  primary_image?: string | null;
  rating_avg?: number;
  review_count?: number;
  is_active: boolean;
  is_featured?: boolean;
  delivery_days?: number;
  created_at?: string;
  images?: ProductImage[];
  variants?: VariantGroup[];
  has_variants?: boolean;
}

export interface ProductImage {
  id: number;
  url: string;
  alt_text?: string;
  sort_order: number;
}

export interface VariantGroup {
  id: number;
  group_name: string;
  type: string;
  sort_order: number;
  options: VariantOption[];
}

export interface VariantOption {
  id: number;
  label: string;
  hex_color?: string;
  price_adjust: number;
  stock_adjust: number;
  is_popular: boolean;
  is_active: boolean;
  sort_order: number;
}

// ── Category ───────────────────────────────────────────────────

export interface Category {
  id: number;
  name: string;
  name_kh?: string;
  merchant_id?: number | null;
  merchant_name?: string | null;
  icon_emoji?: string;
  image_url?: string | null;
  sort_order?: number;
  is_active?: boolean;
  product_count?: number;
}

export interface CategoryBanner {
  id: number;
  category_id: number;
  category_name?: string;
  title: string;
  subtitle?: string | null;
  image_url?: string | null;
  placement: "home" | "category";
  sort_order: number;
  is_active: boolean;
  created_at?: string;
}

// ── Order ──────────────────────────────────────────────────────

export interface OrderItem {
  id: number;
  product_id?: number;
  product_name: string;
  product_sku?: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  selected_variants?: unknown;
}

export interface Order {
  id: number;
  order_code: string;
  user_id: number;
  customer_name?: string;
  customer_phone?: string;
  merchant_id: number;
  merchant_name?: string;
  subtotal: number;
  discount_amount?: number;
  delivery_fee?: number;
  total: number;
  status: string;
  delivery_address?: string;
  payment_method?: string;
  payment_status?: string;
  customer_note?: string;
  admin_note?: string;
  created_at?: string;
  updated_at?: string;
  items?: OrderItem[];
}

// ── Cart ───────────────────────────────────────────────────────

export interface CartItem {
  id: number;
  cart_id: number;
  product_id: number;
  merchant_id?: number;
  quantity: number;
  unit_price: number;
  line_total: number;
  product_name?: string;
  icon_emoji?: string;
  merchant_name?: string;
  primary_image?: string;
  selected_variants?: unknown;
}

export interface Cart {
  items: CartItem[];
  item_count: number;
  subtotal: number;
}

// ── User ───────────────────────────────────────────────────────

export interface User {
  id: number;
  telegram_id?: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  language?: string;
  address?: string;
  is_active?: boolean;
  created_at?: string;
}

// ── Support ────────────────────────────────────────────────────

export interface SupportTicket {
  id: number;
  subject: string;
  status: "open" | "replied" | "closed";
  order_id?: number | null;
  customer_name?: string;
  customer_username?: string;
  last_message?: string;
  message_count?: number;
  created_at?: string;
  updated_at?: string;
  messages?: TicketMessage[];
}

export interface TicketMessage {
  id: number;
  ticket_id: number;
  sender_type: "customer" | "merchant";
  sender_id?: number;
  body: string;
  created_at: string;
}

// ── Promo ──────────────────────────────────────────────────────

export interface PromoCode {
  id: number;
  merchant_id: number;
  code: string;
  type: "percent" | "fixed";
  value: number;
  min_order?: number | null;
  max_uses?: number | null;
  used_count: number;
  expires_at?: string | null;
  is_active: boolean;
  created_at?: string;
}

// ── Review ─────────────────────────────────────────────────────

export interface Review {
  id: number;
  product_id: number;
  user_id: number;
  rating: number;
  comment?: string | null;
  user_name?: string;
  product_name?: string;
  is_approved?: boolean;
  created_at?: string;
}

// ── Notification ───────────────────────────────────────────────

export interface Notification {
  id: number;
  user_id: number;
  type: string;
  title: string;
  body: string;
  ref_id?: number | null;
  is_read?: boolean;
  sent_at?: string;
  user_name?: string;
}

// ── Seller applications ────────────────────────────────────────

export type SellerApplicationStatus = "pending" | "under_review" | "approved" | "rejected";

export interface SellerApplication {
  id: number;
  seller_type: "individual" | "company";
  full_name: string;
  email: string;
  phone?: string | null;
  gender?: string | null;
  date_of_birth?: string | null;
  company_name?: string | null;
  store_name: string;
  store_description?: string | null;
  logo_url?: string | null;
  province?: string | null;
  district?: string | null;
  commune?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  status: SellerApplicationStatus;
  review_note?: string | null;
  merchant_id?: number | null;
  created_at?: string;
  reviewed_at?: string | null;
}

// ── Loyalty ────────────────────────────────────────────────────

export interface LoyaltyAccount {
  id: number;
  user_id: number;
  balance: number;
  lifetime_points: number;
  tier: "bronze" | "silver" | "gold";
  enabled?: boolean;
  next_tier?: string | null;
  points_to_next?: number;
  multiplier?: number;
}

export interface LoyaltySettings {
  id: number;
  is_enabled: boolean;
  points_per_dollar: number;
  points_value_cents: number;
  min_redeem_points: number;
  bronze_threshold: number;
  silver_threshold: number;
  gold_threshold: number;
  silver_multiplier: number;
  gold_multiplier: number;
}

// ── AI ─────────────────────────────────────────────────────────

export interface AIConversation {
  id: number;
  user_id: number;
  title: string;
  status: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  messages?: AIMessage[];
}

export interface AIMessage {
  id: number;
  conversation_id: number;
  role: "user" | "assistant";
  content: string;
  token_count?: number;
  created_at: string;
}

// ── Dashboard Stats ────────────────────────────────────────────

export interface DashboardStats {
  totalProducts: number;
  totalOrders: number;
  totalRevenue: number;
  pendingOrders: number;
  totalUsers: number;
  todayOrders: number;
  todayRevenue: number;
}
