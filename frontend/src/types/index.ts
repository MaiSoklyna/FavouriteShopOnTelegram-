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
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  delivery_radius_km?: number | null;
  /** Migration 017. Null/absent = platform defaults (always open, standard fee bands, no minimum). */
  opening_hours?: Record<string, [string, string][]> | null;
  delivery_base_fee?: number | string | null;
  delivery_per_km_fee?: number | string | null;
  min_order_amount?: number | string | null;
  /** Migration 029: the average of the shop's visible reviews and how many there are. */
  rating?: number | null;
  rating_count?: number;
  /** Migration 024. Null = not categorised yet; the names come from the API next to the ids. */
  shop_category_id?: number | null;
  shop_subcategory_id?: number | null;
  shop_category?: string | null;
  shop_subcategory?: string | null;
  product_count?: number;
  order_count?: number;
  created_at?: string;
}

/** What kind of shop a merchant runs (GET /shop-categories). `shop_count` = active shops under it. */
export interface ShopCategory {
  id: number;
  name: string;
  shop_count?: number;
  subcategories: { id: number; name: string; shop_count?: number }[];
}

// ── Product ────────────────────────────────────────────────────

export interface Product {
  id: number;
  name: string;
  slug: string;
  description?: string;
  merchant_id: number;
  merchant_name?: string;
  merchant_icon?: string | null;
  merchant_logo_url?: string | null;
  merchant_status?: string | null;
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
  /** Live columns from the delivery/payment migrations */
  delivery_type?: "delivery" | "pickup" | null;
  delivery_name?: string | null;
  delivery_phone?: string | null;
  delivery_latitude?: number | null;
  delivery_longitude?: number | null;
  distance_km?: number | null;
  paid_at?: string | null;
  items?: OrderItem[];
  /** Who is bringing it and how far it got (null for pickup orders and until a driver is assigned). */
  delivery?: DeliveryInfo | null;
  /** The customer's review of the shop for this order (null until they leave one). */
  shop_review?: { id: number; rating: number; comment?: string | null; created_at?: string } | null;
}

// ── Shop reviews ───────────────────────────────────────────────

export interface ShopReviewSummary {
  rating: number | null;
  count: number;
  /** How many reviews gave each star, "5" .. "1". */
  distribution: Record<string, number>;
}

export interface ShopReview {
  id: number;
  rating: number;
  comment?: string | null;
  created_at?: string;
  /** First name and last initial, e.g. "Mai S." */
  reviewer: string;
  /** Admin lists only. */
  is_visible?: boolean;
  shop_name?: string | null;
}

// ── Deliveries ─────────────────────────────────────────────────

/** assigned -> accepted -> picked_up -> delivered, or failed / cancelled / declined */
export interface DeliveryInfo {
  status: string;
  driver: { name?: string | null; phone?: string | null; vehicle?: string | null };
  accepted_at?: string | null;
  picked_up_at?: string | null;
  delivered_at?: string | null;
  /** Only in the shop's view. */
  failure_reason?: string | null;
}

export interface DriverProfile {
  id: number;
  merchant_id: number | null;
  full_name: string;
  phone: string;
  vehicle?: string | null;
  is_active: boolean;
  is_available: boolean;
}

/** One delivery as the driver sees it: everything needed to do the job. */
export interface DriverJob {
  delivery: { id: number; status: string; assigned_at?: string; accepted_at?: string | null; picked_up_at?: string | null; delivered_at?: string | null; failure_reason?: string | null };
  order: { id: number; code: string; status: string; total: number | string; payment_method: string; note?: string | null; created_at?: string; item_count: number; items: string[] };
  /** Cash the driver must collect (cash on delivery, not yet paid); 0 otherwise. */
  collect_cash: number;
  shop: { name?: string | null; phone?: string | null; address?: string | null; lat?: number | null; lng?: number | null };
  customer: { name?: string | null; phone?: string | null; address?: string | null; lat?: number | null; lng?: number | null; distance_km?: number | string | null };
}

/** A driver a shop can give an order to. */
export interface AssignableDriver {
  id: number;
  full_name: string;
  phone: string;
  vehicle?: string | null;
  merchant_id: number | null;
  is_available: boolean;
  active_jobs: number;
}

/** A driver in the admin lists. */
export interface AdminDriver extends DriverProfile {
  shop_name?: string | null;
  active_jobs: number;
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
  /** Null on a shop-inbox notification (those carry merchant_id instead). */
  user_id?: number | null;
  merchant_id?: number | null;
  /** The stored enum: order_update | promo | system. */
  type: string;
  /** What happened (migration 027): order_placed, order_paid, order_status, review_request, new_order, payout, ... */
  kind?: string | null;
  title: string;
  body: string;
  ref_id?: number | null;
  /** Where a tap goes inside the app, e.g. /shop/order/35 (migration 027). */
  link?: string | null;
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
  shop_category_id?: number | null;
  shop_subcategory_id?: number | null;
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
  /** Discounts paid by the shop (came out of its revenue) */
  merchantFundedDiscounts?: number;
  /** Discounts paid by the platform (a shop's revenue already includes them) */
  platformFundedDiscounts?: number;
}
