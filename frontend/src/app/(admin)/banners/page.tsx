import { redirect } from "next/navigation";

/** Banners and promotions are one thing now: everything lives on the Promotions page. */
export default function BannersPage() {
  redirect("/promotions");
}
