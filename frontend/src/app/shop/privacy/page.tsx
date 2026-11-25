import type { Metadata } from "next";
import { LegalPage, OPERATOR, type LegalSection } from "@/components/shop/LegalPage";

export const metadata: Metadata = { title: "Privacy Policy · Byme24" };

// Describes what the app actually stores and shares (see docs/FREEZE_PREPARATION.md, the database
// and the backend services). Keep it in step when a feature starts collecting something new.
const SECTIONS: LegalSection[] = [
  {
    title: "What we collect",
    body: (
      <>
        <p><b>When you use Byme24 through Telegram:</b> your Telegram user ID, first and last name, username and, if Telegram shares it, your profile photo. We never see your Telegram password or messages.</p>
        <p><b>When you order:</b> the name and phone number you enter for delivery, your delivery address and the map pin you choose, your note to the shop, what you ordered, prices, discounts and coupons used, and the order&apos;s status history.</p>
        <p><b>When you pay online:</b> the payment reference from ABA PayWay (KHQR) or Stripe (card) and whether the payment succeeded. Your card number and bank login go straight to the payment provider; Byme24 never receives or stores them.</p>
        <p><b>When you use other features:</b> your favourites, reviews you write, loyalty points and coupons, support messages, and questions you type to the shopping assistant.</p>
        <p><b>How you use the shop:</b> which products and shops are viewed, searches (the words searched and how many results came back), items added to cart and orders placed. These are linked to your account if you are signed in, otherwise to a random ID kept in your browser. We do not record your IP address or device details with them.</p>
        <p><b>Sellers and shop staff:</b> the details given in the seller application (name, email, phone, gender and date of birth if given, company and store details), dashboard sign-ins and sign-outs, changes made in the dashboard (the shop&apos;s activity log), and the shop&apos;s payout bank account.</p>
      </>
    ),
  },
  {
    title: "Why we use it",
    body: (
      <ul>
        <li>To take, prepare, deliver and track your orders, and to process payments and refunds.</li>
        <li>To send you order updates in the app and through the Byme24 Telegram bot.</li>
        <li>To run promotions, coupons and the loyalty programme you join.</li>
        <li>To answer support requests and handle disputes.</li>
        <li>To pay shops what they earn and keep accurate financial records.</li>
        <li>To understand which products and searches work, in totals, so the shop gets better. We do not sell this, and we do not use it for advertising.</li>
        <li>To keep the platform safe: preventing fraud, misuse and unauthorised access.</li>
      </ul>
    ),
  },
  {
    title: "Who we share it with",
    body: (
      <>
        <p><b>The shop you order from</b> sees your name, phone number, delivery address and pin, your note and what you ordered, so it can prepare and deliver your order. <b>The driver</b> assigned to your order sees what they need to deliver it.</p>
        <p><b>Service providers</b> that run parts of Byme24 for us, only for that purpose:</p>
        <ul>
          <li>Telegram, to sign you in and send messages;</li>
          <li>ABA PayWay and Stripe, to take payments (card payments are in test mode during the pilot);</li>
          <li>Supabase, which hosts our database and images, and Vercel, which hosts the website;</li>
          <li>Mapbox, to show maps and turn a map pin into an address;</li>
          <li>OpenAI, only for questions you type to the shopping assistant, if you use it.</li>
        </ul>
        <p>We share information with authorities only when the law requires it. We do not sell your personal information.</p>
      </>
    ),
  },
  {
    title: "How long we keep it",
    body: (
      <>
        <p>We keep your account while you use Byme24. Orders, payments, refunds and payouts are kept as long as needed for accounting and legal obligations, because they are financial records. The shop activity log cannot be edited or deleted, so that changes to prices, orders and staff can always be traced.</p>
        <p>If you ask us to delete your account, we remove or anonymise your profile and the information that is not needed for those records.</p>
      </>
    ),
  },
  {
    title: "Your choices and rights",
    body: (
      <ul>
        <li>See and correct your name and phone number in the app (Me).</li>
        <li>Ask us for a copy of your information, to correct it, or to delete your account.</li>
        <li>Stop Telegram messages by blocking the Byme24 bot; order updates stay visible in the app.</li>
        <li>Clear the random browsing ID and recent searches by clearing your browser&apos;s site data.</li>
      </ul>
    ),
  },
  {
    title: "Security",
    body: <p>Connections are encrypted (HTTPS). Passwords for dashboard accounts are stored only as secure hashes. Access to customer details in the dashboard is limited by role, and every important change in a shop is logged. No system is perfectly secure; if we learn of a breach that affects you, we will tell you.</p>,
  },
  {
    title: "Children",
    body: <p>Byme24 is not meant for children under 13, and we do not knowingly collect their information. A parent who believes their child gave us information can contact us to remove it.</p>,
  },
  {
    title: "Changes and contact",
    body: (
      <>
        <p>We will update this page when what we collect or how we use it changes, and change the date at the top. Important changes are also announced in the app.</p>
        <p>Questions or requests about your information: contact {OPERATOR.name} through {OPERATOR.contact}.</p>
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={<p>This explains what personal information {OPERATOR.name} collects when you shop or sell with us, why, who sees it, and what you can do about it. {OPERATOR.name} is a marketplace: independent shops sell through it, and we run the platform, payments and delivery tools.</p>}
      sections={SECTIONS}
      other={{ href: "/shop/terms", label: "Read the Terms of Service" }}
    />
  );
}
