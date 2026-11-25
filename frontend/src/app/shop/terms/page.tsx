import type { Metadata } from "next";
import { LegalPage, OPERATOR, type LegalSection } from "@/components/shop/LegalPage";

export const metadata: Metadata = { title: "Terms of Service · Byme24" };

// The order, payment and refund rules here are the ones the backend enforces (payment window:
// PAYMENT_EXPIRY_MINUTES; cancelling: pending orders only; refunds: services/refunds.py). Keep in step.
const SECTIONS: LegalSection[] = [
  {
    title: "About Byme24",
    body: (
      <>
        <p>{OPERATOR.name} is an online marketplace. Independent shops list and sell their own products through it; {OPERATOR.name} runs the website and Telegram app, takes online payments on the shops&apos; behalf, and provides delivery and support tools.</p>
        <p>When you buy something, your purchase contract is with the shop that sells it. The shop is responsible for its products, their description, price, quality and safety, and for preparing your order.</p>
      </>
    ),
  },
  {
    title: "Your account",
    body: (
      <ul>
        <li>You sign in with Telegram. Keep your Telegram account secure: whoever controls it can order in your name.</li>
        <li>Give a correct name, phone number and delivery location, so the shop and driver can reach you.</li>
        <li>Don&apos;t misuse the platform: no fake orders or reviews, no abusing coupons or loyalty points, no attempts to break or overload the service.</li>
        <li>We may suspend an account that breaks these terms.</li>
      </ul>
    ),
  },
  {
    title: "Orders and prices",
    body: (
      <ul>
        <li>Prices are in US dollars and include what the product page shows. The delivery fee depends on the distance and is shown at checkout, before you order.</li>
        <li>Your order is a request to the shop. It is accepted when the shop confirms it; a shop may decline an order, for example when an item has just run out.</li>
        <li>If a price or fee changes while you are checking out, we show you the new total before anything is charged.</li>
        <li>You can cancel an order yourself while it is still waiting for the shop. Once the shop has accepted it, contact support.</li>
      </ul>
    ),
  },
  {
    title: "Payment",
    body: (
      <ul>
        <li>You can pay cash on delivery (or at the shop for pickup), by ABA KHQR, or by card where offered. During the pilot, card payments run in Stripe&apos;s test mode and no real card is charged.</li>
        <li>Online payments are taken by {OPERATOR.name} on the shop&apos;s behalf, through ABA PayWay or Stripe.</li>
        <li><b>An online order must be paid within 30 minutes.</b> If it isn&apos;t, it expires: the items go back on sale and nothing is charged. You can simply order again.</li>
      </ul>
    ),
  },
  {
    title: "Delivery and pickup",
    body: (
      <ul>
        <li>Delivery times shown are estimates. The shop or its driver brings the order to the location you pinned; make sure someone can receive it.</li>
        <li>When a driver brings your order, give them the 4-digit delivery code shown on your order page. It confirms you received the order, so don&apos;t share it before the order is in your hands.</li>
        <li>For pickup orders, collect your order at the shop when it is marked ready.</li>
        <li>Check your order when it arrives and tell us through support straight away if something is wrong or missing.</li>
      </ul>
    ),
  },
  {
    title: "Cancellations and refunds",
    body: (
      <ul>
        <li>If you paid online and the order is cancelled (by you, the shop or us), or your payment arrives after the order was cancelled or had expired, you get the full amount back.</li>
        <li>Refunds go back the way you paid, or by bank transfer to you. We tell you in the app when the refund is sent; your bank may take a few days to show it.</li>
        <li>For problems with a delivered order (wrong, damaged or missing items), contact support. The shop decides on a replacement or refund under its own policy and the law; we help settle disagreements.</li>
        <li>Cash payments are made to the shop, so refunds of cash are arranged with the shop.</li>
      </ul>
    ),
  },
  {
    title: "Promotions, coupons and loyalty points",
    body: (
      <ul>
        <li>Coupons and promotions have their own conditions (minimum order, dates, number of uses, which shops). They have no cash value and cannot be exchanged for money.</li>
        <li>Loyalty points are earned on delivered orders and can be turned into coupons. Points from an order that is cancelled are removed.</li>
        <li>We may change or end a promotion or the loyalty programme; coupons you already hold stay valid until they expire.</li>
      </ul>
    ),
  },
  {
    title: "Reviews",
    body: <p>You can rate a shop once your order has been delivered, one review per order. Reviews must be honest and about your own experience. We may hide reviews that are abusive, fake or unrelated.</p>,
  },
  {
    title: "Selling on Byme24",
    body: (
      <ul>
        <li>Shops join through a seller application that we review. A shop must give true information about itself and its products, honour its prices and orders, and follow the law, including on product safety.</li>
        <li>For online payments, {OPERATOR.name} keeps the agreed commission and pays the rest to the shop&apos;s verified payout account in a monthly settlement. Amounts for cancelled or refunded orders are taken back.</li>
        <li>Shop owners are responsible for the staff accounts they create; everything staff do in the dashboard is recorded in the shop&apos;s activity log.</li>
      </ul>
    ),
  },
  {
    title: "Liability",
    body: (
      <>
        <p>We work to keep Byme24 available and correct, but we can&apos;t promise it will always be uninterrupted or error-free. As a marketplace, we are not the seller of the products and are not responsible for a shop&apos;s products or its failure to deliver, except where the law says otherwise.</p>
        <p>Nothing in these terms limits rights you have under the consumer protection law of {OPERATOR.country}.</p>
      </>
    ),
  },
  {
    title: "Changes, law and contact",
    body: (
      <>
        <p>We may update these terms; the date at the top shows the latest version, and important changes are announced in the app. Using Byme24 after a change means you accept the new terms.</p>
        <p>These terms are governed by the law of {OPERATOR.country}. Questions: contact {OPERATOR.name} through {OPERATOR.contact}.</p>
      </>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro={<p>These terms apply when you shop or sell on {OPERATOR.name}, on the website or in Telegram. Please read them with our Privacy Policy. By using {OPERATOR.name} you agree to them.</p>}
      sections={SECTIONS}
      other={{ href: "/shop/privacy", label: "Read the Privacy Policy" }}
    />
  );
}
