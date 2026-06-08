# Document Rewrite Guide
## Ecommerce Telegram Bot — Updated to Match Actual Implementation

Below are the corrected sections. Copy each section into your .docx to replace the outdated content.

---

## Section 1.1 — Problem Description (ADD this paragraph at the end)

**The Solution:** Build a shopping marketplace inside Telegram (not a separate app) because:
- Merchants already use Telegram to reach customers
- Customers already use Telegram daily (so no need to download another app)
- It provides an affordable, organized alternative to expensive delivery apps
- It creates a unified space where customers can discover, browse, and purchase from multiple verified merchants while merchants can manage orders, payments, and customer data efficiently
- The system supports product variants (sizes, colors), promo codes, loyalty rewards, and customer support — features not available in manual Telegram selling

---

## Section 4.1 — Use Case Diagram (REPLACE Customer and Admin use cases)

### Customer Use Cases:
- Register and login automatically via Telegram account
- Browse product categories and merchants
- View product details with images, variants (size/color), and reviews
- Add products to shopping cart with variant selection
- Apply promo codes at checkout for discounts
- Place order with delivery address and payment method (KHQR / Cash on Delivery)
- View order status and track delivery progress (Pending > Confirmed > Processing > Shipped > Delivered)
- Rate and review products (reviews require admin approval before appearing)
- View and manage loyalty rewards points
- Contact merchant through support ticket system
- View previous order history
- Receive push notifications for order updates and promotions
- Toggle between light and dark theme

### Merchant Admin Use Cases:
- Login to web dashboard via email/password or Telegram Login
- Add new products with descriptions, prices, images, and variant options (sizes, colors)
- Edit product information, stock, and availability
- Delete or deactivate products from catalog
- View list of incoming orders with status filtering
- Confirm receipt of orders and update status (confirmed, processing, shipped, delivered)
- View sales statistics and revenue on analytics dashboard
- Respond to customer support tickets
- Manage shop settings (name, description, logo, hero images)
- Create and manage promotional discount codes

### Super Admin Use Cases:
- Manage merchant accounts (create, suspend, activate)
- Approve or reject customer reviews before they appear publicly
- Monitor all platform orders across merchants
- Create platform-wide promotions and promo codes
- Manage product categories (with Khmer language support)
- Manage category banners for homepage and category pages
- Configure loyalty program settings (points rate, tiers, redemption)
- Send notifications to users
- View platform-wide analytics (total users, orders, revenue)
- Manage admin user accounts

---

## Section 4.2 — Database Design (REPLACE entire section)

The database is hosted on **Supabase (PostgreSQL)** with Row Level Security (RLS) policies. All data access goes through the FastAPI backend via PostgREST API — no direct client-side database access is allowed. The design uses proper relationships and foreign keys to maintain data integrity and support multi-merchant architecture.

### Main Tables:

**1. Users Table**
- id - Auto-increment primary key
- telegram_id - Telegram's unique user ID (used for authentication)
- username - Telegram username
- first_name - User's first name
- last_name - User's last name
- phone - Contact phone number
- email - Email address (optional)
- language - Preferred language
- address - Default delivery address
- is_active - Account active status
- created_at - When account was created

**2. Merchants Table**
- id - Auto-increment primary key
- name - Name of the shop
- slug - URL-friendly unique identifier
- owner_name - Name of shop owner
- email - Shop email
- phone - Shop phone number
- tagline - Short description shown on shop card
- description - Full description of shop
- icon_emoji - Emoji icon for the shop
- accent_color - Brand color for shop page
- logo_url - Shop logo image URL (stored in Supabase Storage)
- plan - Subscription plan
- status - Shop status (active, suspended)
- is_featured - Featured on homepage
- fb_page - Facebook page URL
- instagram - Instagram URL
- telegram_group_id - Linked Telegram group for notifications
- created_at - When shop was registered

**3. Super Admins Table**
- id - Auto-increment primary key
- email - Admin email (unique)
- name - Admin display name
- password_hash - Bcrypt-encrypted password
- is_active - Account active status
- created_at - When created

**4. Merchant Admins Table**
- id - Auto-increment primary key
- merchant_id - Link to merchant (foreign key)
- email - Admin email (unique)
- name - Admin display name
- password_hash - Bcrypt-encrypted password
- is_active - Account active status
- created_at - When created

**5. Products Table**
- id - Auto-increment primary key
- merchant_id - Which merchant owns this product (foreign key)
- category_id - Product category (foreign key)
- name - Product name
- slug - URL-friendly identifier (auto-generated)
- description - Product details
- sku - Stock keeping unit
- base_price - Regular price
- compare_price - Original/compare price for discount display
- stock - Quantity available
- weight - Product weight
- delivery_days - Expected delivery time
- icon_emoji - Emoji for fallback display
- rating_avg - Average customer rating (calculated from approved reviews)
- review_count - Number of approved reviews
- is_active - Product visibility
- is_featured - Featured product flag
- created_at - When created

**6. Product Images Table**
- id - Auto-increment primary key
- product_id - Link to product (foreign key)
- url - Image URL (stored in Supabase Storage bucket "product-images")
- alt_text - Image alt text
- sort_order - Display order

**7. Variant Groups Table (Product Options)**
- id - Auto-increment primary key
- product_id - Link to product (foreign key)
- group_name - Option group name (e.g., "Size", "Color")
- type - Variant type (size, color, weight, custom)
- sort_order - Display order

**8. Variant Options Table**
- id - Auto-increment primary key
- variant_group_id - Link to variant group (foreign key)
- label - Option label (e.g., "Small", "Red")
- hex_color - Color hex value (for color-type variants)
- price_adjust - Price difference from base price
- stock_adjust - Stock for this specific variant
- is_popular - Popular option flag
- is_active - Option availability
- sort_order - Display order

**9. Categories Table**
- id - Auto-increment primary key
- merchant_id - Optional merchant scope (foreign key)
- name - Category name (English)
- name_kh - Category name (Khmer)
- icon_emoji - Category icon
- image_url - Category image
- sort_order - Display order
- is_active - Category visibility
- created_at - When created

**10. Category Banners Table**
- id - Auto-increment primary key
- category_id - Link to category (foreign key)
- title - Banner title
- subtitle - Banner subtitle
- image_url - Banner image URL
- placement - Where to show: "home" or "category"
- sort_order - Display order
- is_active - Banner visibility
- created_at - When created

**11. Cart Table**
- id - Auto-increment primary key
- user_id - Which customer (foreign key)

**12. Cart Items Table**
- id - Auto-increment primary key
- cart_id - Link to cart (foreign key)
- product_id - Which product (foreign key)
- quantity - How many
- unit_price - Price per item
- line_total - Calculated total for this item
- selected_variants - JSON array of selected variant options
- created_at - When added to cart

**13. Orders Table**
- id - Auto-increment primary key
- order_code - Human-readable code (e.g., FS-20260525-001)
- merchant_id - Which merchant fulfilled order (foreign key)
- user_id - Which customer placed order (foreign key)
- customer_name - Customer name (stored directly for history)
- customer_phone - Customer phone (stored directly for history)
- subtotal - Sum of items before discount
- discount_amount - Discount from promo code
- delivery_fee - Delivery charge
- total - Final amount after discount + delivery
- status - Order status (pending, confirmed, processing, shipped, delivered, cancelled)
- payment_method - KHQR, COD (Cash on Delivery), ABA, or Wing
- payment_status - Payment tracking
- delivery_address - Full delivery address
- delivery_province - Province for delivery
- customer_note - Customer notes
- admin_note - Merchant internal notes
- promo_code - Applied promo code
- created_at - When order was placed
- updated_at - Last status update

**14. Order Items Table**
- id - Auto-increment primary key
- order_id - Which order (foreign key)
- product_id - Which product (foreign key)
- product_name - Product name (snapshot at time of order)
- product_sku - Product SKU (snapshot)
- quantity - How many ordered
- unit_price - Price per item at time of order
- subtotal - Total for this line item
- selected_variants - JSON of variant choices

**15. Reviews Table**
- id - Auto-increment primary key
- product_id - Which product (foreign key)
- user_id - Which customer (foreign key)
- order_id - Which order (optional foreign key)
- rating - Star rating (1-5)
- comment - Written review text
- is_approved - Admin approval status (default: false)
- created_at - When review posted

**16. Promo Codes Table**
- id - Auto-increment primary key
- merchant_id - Which merchant (foreign key, null = platform-wide)
- code - Promo code string (unique)
- type - Discount type (percent or fixed)
- value - Discount value
- min_order - Minimum order amount to apply
- max_uses - Maximum total uses
- used_count - Current use count
- expires_at - Expiration date
- is_active - Promo availability
- created_at - When created

**17. Promo Usages Table**
- id - Auto-increment primary key
- promo_id - Which promo code (foreign key)
- user_id - Which customer used it (foreign key)
- order_id - Which order (foreign key)
- created_at - When used

**18. Loyalty Accounts Table**
- id - Auto-increment primary key
- user_id - Which customer (foreign key)
- balance - Current points balance
- lifetime_points - Total points ever earned
- tier - Current tier (bronze, silver, gold)
- created_at - When created

**19. Loyalty Settings Table**
- id - Single row configuration
- is_enabled - Loyalty program on/off
- points_per_dollar - Points earned per $1 spent
- points_value_cents - Cash value per point (in cents)
- min_redeem_points - Minimum points to redeem
- bronze_threshold - Points needed for Bronze
- silver_threshold - Points needed for Silver
- gold_threshold - Points needed for Gold
- silver_multiplier - Points multiplier for Silver tier
- gold_multiplier - Points multiplier for Gold tier

**20. Notifications Table**
- id - Auto-increment primary key
- user_id - Target user (foreign key)
- type - Notification type (promo, order, system, loyalty)
- title - Notification title
- body - Notification content
- ref_id - Reference to related entity
- is_read - Read status
- sent_at - When sent

**21. Support Tickets Table**
- id - Auto-increment primary key
- subject - Issue subject
- status - Ticket status (open, replied, closed)
- order_id - Related order (optional foreign key)
- customer_name - Customer display name
- customer_username - Customer Telegram username
- last_message - Preview of latest message
- message_count - Total messages in thread
- created_at - When created
- updated_at - Last activity

**22. Ticket Messages Table**
- id - Auto-increment primary key
- ticket_id - Which ticket (foreign key)
- sender_type - Who sent it (customer or merchant)
- sender_id - Sender user ID
- body - Message content
- created_at - When sent

**23. Login Sessions Table**
- id - Session identifier
- telegram_id - Linked Telegram user
- status - Session status (pending, completed, expired)
- created_at - When created

**24. Telegram Sessions Table**
- id - Session identifier
- telegram_id - Linked Telegram user
- created_at - When created

**25. Merchant Hero Images Table**
- id - Auto-increment primary key
- merchant_id - Which merchant (foreign key)
- url - Hero image URL
- sort_order - Display order
- is_active - Visibility
- created_at - When uploaded

### Key Relationships:
- One merchant can have many products, orders, and admins
- One product can have many images, variant groups, reviews, and order items
- One variant group can have many variant options
- One customer can place many orders and have one cart
- One order can contain many order items
- One customer can write many reviews (one per product, requires admin approval)
- One support ticket contains many messages (customer-merchant conversation)
- One customer has one loyalty account with points and tier

---

## Section 5.1 — Implementation Overview (REPLACE)

This project implements a multi-component e-commerce system inside Telegram. The implementation is structured around a single backend service that provides REST APIs for both user interfaces: (1) a Telegram Mini App for customers and (2) a Next.js web dashboard for merchants and administrators. All data is centralized in a Supabase PostgreSQL database to ensure consistent product listings, orders, and user information across the entire system.

The system uses a webhook architecture for Telegram integration. Instead of polling, Telegram pushes updates to the backend through an HTTPS webhook endpoint, enabling near real-time responses and reducing repeated requests to Telegram servers.

Key architectural decisions:
- **Supabase PostgreSQL** replaces traditional MySQL, providing managed hosting, automatic backups, Row Level Security, and a built-in Storage bucket for product images
- **PostgREST API** is used for all database operations through the FastAPI backend — no direct client-side database access
- **JWT authentication** with tokens signed using the Supabase JWT secret, compatible with Supabase's security model
- **Serverless deployment** on Vercel for the backend, Cloudflare Pages for the frontend

---

## Section 5.2 — High-Level System Architecture (REPLACE)

The system consists of the following main components:

**Telegram Mini App (Customer Interface)**
The customer shopping experience is built as a Telegram Mini App using Next.js. When customers open the bot and tap "Shop," Telegram opens a web view inside the app showing the full e-commerce interface. Customers can browse products, manage their cart, checkout, track orders, and leave reviews — all without leaving Telegram. The Mini App authenticates users automatically using Telegram's initData, so no manual login is required.

**Web Dashboard (Merchant/Admin Interface) — Next.js**
The merchant/admin dashboard is implemented using Next.js with TypeScript and Tailwind CSS, plus a custom design system using Kantumruy Pro and Inter fonts with a navy-and-gold color theme. It provides merchant functions such as product management (CRUD with variant options), order confirmation, review approval, analytics, and promotional tools. Admins can log in via email/password or through a Telegram-based session login flow.

**Backend API Server — FastAPI + Uvicorn**
The backend is implemented using FastAPI (Python) and served using Uvicorn. It provides 16 route modules with REST endpoints for authentication, products, cart, orders, reviews, loyalty, support, notifications, AI assistant, and analytics. The backend acts as the single gateway to the database — all security checks, business rules, and data validation happen here. Rate limiting is enforced on sensitive endpoints using slowapi.

**Database — Supabase (PostgreSQL)**
Supabase provides a managed PostgreSQL database with built-in features: Row Level Security for data isolation, PostgREST for automatic REST API generation, and Storage buckets for file uploads (product images, merchant logos, banners). The backend communicates with Supabase via its PostgREST API using httpx (async HTTP client), not through a traditional ORM.

**File Storage — Supabase Storage**
Product images, merchant logos, hero carousel images, and category banners are stored in Supabase Storage buckets. The backend handles file uploads with validation (file type, size limits, rate limiting for merchant logo changes) and returns public URLs that load directly from Supabase CDN.

---

## Section 5.4 — Authentication & Security (REPLACE)

### Customer Authentication (Telegram Mini App)
Customers are automatically authenticated when they open the Mini App inside Telegram. The system reads the Telegram initData payload which contains the user's telegram_id, username, and name. This data is verified server-side and a JWT token is issued for subsequent API requests. No passwords or manual login required.

### Admin Authentication (Dashboard)
Two authentication methods are supported for the admin dashboard:

1. **Email/Password Login**: Admins enter their email and password. The backend verifies credentials against bcrypt-hashed passwords stored in super_admins or merchant_admins tables. A JWT token is returned upon success.

2. **Telegram Session Login**: Admins can click "Login with Telegram" which generates a unique session ID. The admin opens the Telegram bot with this session ID, taps START, and the backend validates the Telegram identity. The dashboard polls for session completion and receives a JWT token when confirmed.

### JWT Token Structure
All tokens are signed with HS256 using the Supabase JWT secret. Token claims include: sub (user ID), role (user/merchant_admin/super_admin), telegram_id, merchant_id (for merchant admins), email, name, and standard exp/iat fields. Tokens expire after 24 hours for admin sessions and user sessions.

### Security Measures
- All API requests require Bearer token authentication (except public endpoints like product browsing)
- Role-based access control: USER, MERCHANT_ADMIN, SUPER_ADMIN with permission checks on every protected endpoint
- Rate limiting on login endpoints (5 attempts/minute), logo uploads (2 per 7 days for merchant admins)
- No direct Supabase client exposure — all data flows through the backend
- CORS configured with explicit allowed origins for production domains

---

## Section 5.5 — Detail Project Features (REPLACE the table)

| Module | Feature | Detailed Description |
|--------|---------|---------------------|
| **Authentication** | Telegram Login (Customer) | Customers log in automatically using their Telegram account, identified via telegram_id from Mini App initData. No password required. |
| | Admin Login (Email/Password) | Merchants and super admins authenticate via email and password with bcrypt verification. Role selection determines access level. |
| | Admin Login (Telegram Session) | Alternative login: admin generates session ID, opens Telegram bot, taps START. Dashboard polls for completion. |
| | Session Management | JWT-based authentication. Tokens expire after 24 hours. Stored in localStorage and cookies. |
| **Customer (Mini App)** | Browse Categories | View all product categories with images and Khmer language names inside Telegram Mini App. |
| | Browse Products | Browse products by category, merchant, or search query with pagination. |
| | View Product Details | Display images (auto-sliding carousel), description, stock status, delivery days, variant options, and approved reviews. |
| | Product Variants | Select size, color, weight, or custom options. Price adjusts per variant. Stock tracked per variant option. |
| | Add/Remove Cart Items | Add products with selected variants to persistent cart. Update quantity or remove items. |
| | Apply Promo Code | Enter promo code at checkout for percentage or fixed discount. Validated against merchant, minimum order, usage limits, and expiry. |
| | Checkout | Input delivery address and province, choose payment method (KHQR / COD / ABA / Wing), apply promo codes. |
| | Order Tracking | Check real-time status: Pending > Confirmed > Processing > Shipped > Delivered. Auto-refresh every 10-15 seconds. |
| | Review Products | Leave 1-5 star rating and comment. Reviews require admin approval before appearing publicly. One review per product per user. |
| | Loyalty Rewards | Earn points per purchase. Three tiers: Bronze, Silver, Gold with multiplier bonuses. Redeem points for discounts. |
| | Support Tickets | Create support tickets linked to orders. Threaded messages between customer and merchant. |
| | Notifications | Receive order updates, promotions, and system announcements. Unread count shown on bell icon. |
| | Dark/Light Theme | Toggle between dark and light mode. Theme persists across sessions via localStorage. |
| | Contact Merchant | View merchant phone, Facebook, and Instagram links directly from shop page. |
| **Merchant Dashboard** | Product Management | Add/edit/delete products with multiple images, descriptions, pricing, stock, SKU, and variant groups (size, color, etc.). |
| | Order Management | View incoming orders, confirm receipt, update status through delivery pipeline, add admin notes. |
| | Review Approval | View pending customer reviews, approve or reject before they appear on product pages. |
| | Dashboard Analytics | View total sales, order count, revenue, pending orders, and daily metrics with interactive charts (Recharts). |
| | Promotions | Create discount codes with type (percent/fixed), value, minimum order, max uses, and expiry date. |
| | Customer Support | Respond to customer support tickets with threaded messaging. |
| | Shop Settings | Edit shop name, tagline, description, phone, social links. Upload logo (rate-limited: 2 per 7 days). Manage hero carousel images (up to 6). |
| | Category Management | Create and organize product categories with icons, images, and Khmer names. |
| **Super Admin** | Manage Merchants | Create, activate, suspend merchant accounts. Set featured status. |
| | Manage Categories | Platform-wide category management with banner images for homepage and category pages. |
| | Review Moderation | Approve, reject, or delete customer reviews across all merchants. |
| | Loyalty Settings | Configure points per dollar, redemption value, tier thresholds, and multipliers. Enable/disable program. |
| | Send Notifications | Broadcast notifications to users (promo, order, system, loyalty types). |
| | Manage Users | View and manage customer accounts. |
| | Platform Analytics | View platform-wide statistics across all merchants. |
| **Backend (FastAPI)** | Authentication API | JWT token issuance, Telegram hash verification, bcrypt password validation, session polling. |
| | Products API | CRUD for merchants, list/filter/search for customers, variant group management, image upload. |
| | Cart API | Persistent cart with variant-aware items, quantity management, automatic price calculation. |
| | Orders API | Order creation via atomic database transaction, status updates, cancellation, KHQR QR code generation. |
| | Reviews API | Submit reviews (pending approval), list approved reviews, admin approve/reject/delete. Rating recalculation from approved reviews only. |
| | Promo API | Validate codes, check usage limits, admin CRUD for promo codes. |
| | Loyalty API | Account management, point earning/redemption, tier calculations, admin settings. |
| | Support API | Ticket creation, threaded messages, admin ticket management. |
| | Notifications API | Send, list, mark read, admin broadcast. |
| | Analytics API | Dashboard statistics, order analytics with date filtering. |
| | AI Chat API | Conversational assistant with OpenAI integration, conversation history, token tracking. |
| | Webhook Processor | Handles Telegram bot updates in real time via HTTPS webhook. |
| **Database (Supabase PostgreSQL)** | User Tables | users, super_admins, merchant_admins — separate tables for customers and admin roles. |
| | Merchant Tables | merchants, merchant_hero_images — shop info, logos, hero carousel. |
| | Product Catalog | products, product_images, variant_groups (renamed from product_variants), variant_options (renamed from product_variant_options), categories, category_banners. |
| | Shopping & Orders | carts, cart_items, orders, order_items — full e-commerce flow with variant snapshots. |
| | Engagement | reviews (with admin approval), promo_codes, promo_usages, loyalty_accounts, loyalty_settings. |
| | Communication | notifications, support_tickets, ticket_messages — customer engagement and support. |
| | Sessions | login_sessions, telegram_sessions — authentication session management. |
| | File Storage | Supabase Storage bucket "product-images" — stores product photos, logos, banners, hero images. |

---

## Section 5.5 — Technologies Used (REPLACE)

The implementation uses the following technologies:

### Backend
- **FastAPI** (v0.104.1+) — REST API framework providing structured endpoints and automatic OpenAPI documentation
- **Uvicorn** (v0.24.0+) — ASGI server for running FastAPI in production
- **Pydantic** (v2.5.0+) — Request/response validation via typed models
- **httpx** (v0.25.0+) — Async HTTP client for communicating with Supabase PostgREST API
- **PyJWT** (v2.8.0+) — JWT token creation and verification
- **bcrypt** (v4.0.1+) — Password hashing for admin accounts
- **slowapi** (v0.1.9+) — Rate limiting on sensitive endpoints
- **Pillow** (v10.1.0+) — Image processing for uploads
- **qrcode** (v7.4.2+) — KHQR payment QR code generation
- **python-dotenv** (v1.0.0+) — Environment variable management

### Telegram Bot
- **python-telegram-bot** (v20.7+) — Receives messages and sends responses through Telegram Bot API via webhook

### Frontend (Dashboard + Mini App)
- **Next.js** (v15.0.0) — React framework for both admin dashboard and customer Mini App
- **React** (v18.3.1) — UI component library
- **TypeScript** (v5.3.0) — Type-safe JavaScript
- **Tailwind CSS** (v3.4.0) — Utility-first CSS framework
- **Recharts** (v2.15.0) — Interactive charts for analytics dashboard
- **react-icons** (v5.6.0) — Icon library for admin interface
- Custom design system: Kantumruy Pro font (headings) + Inter font (body), navy (#103562) + gold (#D6BA80) color palette

### Database & Storage
- **Supabase** — Managed PostgreSQL database with PostgREST API, Row Level Security, and Storage buckets
- **PostgreSQL** — Relational database (hosted on Supabase)

### Deployment
- **Vercel** — Backend (FastAPI as serverless function) and frontend hosting
- **Cloudflare Pages** — Frontend CDN and hosting (alternative deployment)
- **Railway** — Telegram bot long-polling process hosting

### Environment Variables (Important Note for Next.js)
Next.js exposes environment variables to the browser only if they are prefixed with NEXT_PUBLIC_. Variables without this prefix are available only on the server side. This is important when configuring items such as the public API base URL used in client-side requests. The backend API URL is configured via NEXT_PUBLIC_API_URL.

---

## Section 6 — Testing (REPLACE tools section at end)

### Testing Tools Used:
- **Telegram App** — Testing Mini App customer flows (browse, cart, checkout, order tracking)
- **Swagger UI** (FastAPI built-in) — Rapid API endpoint verification with automatic documentation
- **Postman** — Comprehensive API testing with JWT authentication, negative testing, and edge cases
- **Chrome/Edge DevTools** — Frontend debugging, responsive mode testing, network inspection
- **Supabase Dashboard** — Database verification, SQL queries, storage management (replaces MySQL Workbench)
- **Vercel Dashboard** — Deployment logs, serverless function monitoring, environment variable management
- **ngrok** — Local development webhook tunneling for Telegram bot testing

---

## Section 7 — Future Work (REPLACE)

1. **Complete Payment Gateway Integration** — Integrate real KHQR payment processing with bank API verification (currently supports COD and manual KHQR confirmation)
2. **Merchant Subscription System** — Implement 7-day free trial + paid subscription plans for merchants with tiered feature access
3. **Automated Telegram Notifications** — Send order status updates and promotional messages directly to customers via Telegram bot messages
4. **Enhanced Analytics** — Add revenue forecasting, customer segmentation, product performance trends, and exportable reports
5. **Multi-language Support** — Extend Khmer language support beyond category names to full product descriptions and UI labels
6. **Shipping Integration** — Connect with local Cambodian delivery services for automated shipping calculations and real-time tracking
7. **Invoice Generation** — Generate downloadable PDF invoices for completed orders

---

## Section 9 — References (ADD these)

- https://supabase.com/docs — Supabase Documentation (PostgreSQL, PostgREST, Storage)
- https://fastapi.tiangolo.com/ — FastAPI Documentation
- https://nextjs.org/docs — Next.js Documentation
- https://core.telegram.org/bots/webapps — Telegram Mini Apps Documentation
- https://core.telegram.org/bots/api — Telegram Bot API
- https://tailwindcss.com/docs — Tailwind CSS Documentation
- https://recharts.org/en-US — Recharts Documentation
- https://vercel.com/docs — Vercel Deployment Documentation
- https://pydantic-docs.helpmanual.io/ — Pydantic Documentation
