import { forwardRef, type SVGProps } from "react";

/**
 * Byme24 icon family — React versions of brand/icons.svg and brand/icons-ui.svg.
 * 24px grid, 1.6 stroke, every glyph carries the logo's pointed-leaf motif.
 * Colour comes from `currentColor`; `size` sets width and height (24 by default,
 * 96 for the two illustrations), so they drop in where react-icons were used.
 */
export interface BrandIconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  size?: number | string;
  /** Accessible name. Without it the icon is decorative (aria-hidden). */
  title?: string;
}

function brandIcon(name: string, viewBox: number, strokeWidth: number, body: React.ReactNode, defaultSize = 24) {
  const Icon = forwardRef<SVGSVGElement, BrandIconProps>(function Icon({ size = defaultSize, title, ...rest }, ref) {
    return (
      <svg
        ref={ref}
        width={size}
        height={size}
        viewBox={`0 0 ${viewBox} ${viewBox}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        aria-hidden={title ? undefined : true}
        role={title ? "img" : undefined}
        {...rest}
      >
        {title && <title>{title}</title>}
        {body}
      </svg>
    );
  });
  Icon.displayName = name;
  return Icon;
}
export const StoreIcon = brandIcon("StoreIcon", 24, 1.6, (
  <>
      <path d="M3.5 9 6 4h12l2.5 5" />
      <path d="M3.5 9a2.8 2.8 0 0 0 5.67 0 2.8 2.8 0 0 0 5.66 0 2.8 2.8 0 0 0 5.67 0" />
      <path d="M5 11.5V20h14v-8.5" />
      <path d="M12 13a5 5 0 0 1 0 7 5 5 0 0 1 0-7Z" />
  </>
));
export const PromoIcon = brandIcon("PromoIcon", 24, 1.6, (
  <>
      <path d="M3 12.5 11.5 4H20v8.5L11.5 21Z" />
      <path d="M16 5.5a3.2 3.2 0 0 1 0 5 3.2 3.2 0 0 1 0-5Z" />
      <path d="m8.5 15.5 4-4" />
  </>
));
export const OrdersIcon = brandIcon("OrdersIcon", 24, 1.6, (
  <>
      <path d="M5 8h14l-1 13H6Z" />
      <path d="M9 8a3 3 0 0 1 6 0" />
      <path d="M12 11.5a4.5 4.5 0 0 1 0 6.5 4.5 4.5 0 0 1 0-6.5Z" />
  </>
));
export const RewardsIcon = brandIcon("RewardsIcon", 24, 1.6, (
  <>
      <path d="M12 3a6 6 0 0 1 0 9 6 6 0 0 1 0-9Z" />
      <path d="M12 3a6 6 0 0 1 0 9 6 6 0 0 1 0-9Z" transform="rotate(120 12 12)" />
      <path d="M12 3a6 6 0 0 1 0 9 6 6 0 0 1 0-9Z" transform="rotate(240 12 12)" />
      <path d="M8 18.5 7 22l5-2 5 2-1-3.5" />
  </>
));
export const DeliveryIcon = brandIcon("DeliveryIcon", 24, 1.6, (
  <>
      <path d="M8.5 6.5h12v12h-12Z" />
      <path d="M2.5 9.5H6M3.5 12.5H6M4.5 15.5H6" />
      <path d="M14.5 8.5a5 5 0 0 1 0 8 5 5 0 0 1 0-8Z" />
  </>
));  // redrawn for 20–24px legibility
export const EmptyStateIcon = brandIcon("EmptyStateIcon", 120, 2, (
  <>
      <circle cx="60" cy="60" r="54" strokeDasharray="4 7" opacity=".5" />
      <g transform="translate(10 6)" strokeDasharray="6 5"><path d="M50 18A26 26 0 0 1 50 58A26 26 0 0 1 50 18Z" />
      <path d="M50 18A26 26 0 0 1 50 58A26 26 0 0 1 50 18Z" transform="rotate(120 50 58)" />
      <path d="M50 18A26 26 0 0 1 50 58A26 26 0 0 1 50 18Z" transform="rotate(240 50 58)" />
      </g>
  </>
), 96);
export const SuccessIcon = brandIcon("SuccessIcon", 120, 2.4, (
  <>
      <circle cx="60" cy="60" r="54" />
      <g transform="translate(10 6)" opacity=".35"><path d="M50 18A26 26 0 0 1 50 58A26 26 0 0 1 50 18Z" />
      <path d="M50 18A26 26 0 0 1 50 58A26 26 0 0 1 50 18Z" transform="rotate(120 50 58)" />
      <path d="M50 18A26 26 0 0 1 50 58A26 26 0 0 1 50 18Z" transform="rotate(240 50 58)" />
      </g><path d="m42 62 12 12 26-28" strokeWidth="5" />
  </>
), 96);
export const HomeIcon = brandIcon("HomeIcon", 24, 1.6, (
  <>
      <path d="M3.5 10 12 3.5l8.5 6.5v10.5h-17Z" />
      <path d="M12 13a4.5 4.5 0 0 1 0 7.5 4.5 4.5 0 0 1 0-7.5Z" />
  </>
));
export const CategoryIcon = brandIcon("CategoryIcon", 24, 1.6, (
  <>
      <path d="M3.5 3.5h6.5v6.5H3.5ZM14 3.5h6.5v6.5H14ZM3.5 14h6.5v6.5H3.5Z" />
      <path d="M17.25 13.5a4.5 4.5 0 0 1 0 7 4.5 4.5 0 0 1 0-7Z" />
  </>
));
export const SearchIcon = brandIcon("SearchIcon", 24, 1.6, (
  <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
      <path d="M10.5 7.5a4 4 0 0 1 0 6 4 4 0 0 1 0-6Z" />
  </>
));
export const CartIcon = brandIcon("CartIcon", 24, 1.6, (
  <>
      <path d="M3 4h2.2l2.3 11h11l2-8H6.3" />
      <circle cx="9" cy="19.5" r="1.3" />
      <circle cx="17" cy="19.5" r="1.3" />
      <path d="M13 8a3.5 3.5 0 0 1 0 5 3.5 3.5 0 0 1 0-5Z" />
  </>
));
export const ProfileIcon = brandIcon("ProfileIcon", 24, 1.6, (
  <>
      <path d="M12 3a5 5 0 0 1 0 8.5 5 5 0 0 1 0-8.5Z" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
  </>
));
export const BellIcon = brandIcon("BellIcon", 24, 1.6, (
  <>
      <path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15Z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
      <path d="M12 8.5a3.5 3.5 0 0 1 0 5.5 3.5 3.5 0 0 1 0-5.5Z" />
  </>
));
export const FavouriteIcon = brandIcon("FavouriteIcon", 24, 1.6, (
  <>
      <path d="M12 6a8 8 0 0 1 0 14 8 8 0 0 1 0-14Z" transform="rotate(-35 12 20)" />
      <path d="M12 6a8 8 0 0 1 0 14 8 8 0 0 1 0-14Z" transform="rotate(35 12 20)" />
  </>
));
export const SupportIcon = brandIcon("SupportIcon", 24, 1.6, (
  <>
      <path d="M4 4.5h16V16H9.5L4 20Z" />
      <path d="M12 7a3.5 3.5 0 0 1 0 6 3.5 3.5 0 0 1 0-6Z" />
  </>
));
export const QrIcon = brandIcon("QrIcon", 24, 1.6, (
  <>
      <path d="M3.5 8V3.5H8M16 3.5h4.5V8M20.5 16v4.5H16M8 20.5H3.5V16" />
      <path d="M12 6.5a5 5 0 0 1 0 11 5 5 0 0 1 0-11Z" />
      <circle cx="12" cy="12" r="1.6" />
  </>
));
export const LocationIcon = brandIcon("LocationIcon", 24, 1.6, (
  <>
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" />
      <path d="M12 6a3.5 3.5 0 0 1 0 6 3.5 3.5 0 0 1 0-6Z" />
  </>
));
export const DashboardIcon = brandIcon("DashboardIcon", 24, 1.6, (
  <>
      <path d="M3.5 3.5h7.5v6H3.5ZM13 3.5h7.5v10H13ZM13 15.5h7.5v5H13Z" />
      <path d="M7.25 12a4.5 4.5 0 0 1 0 8.5 4.5 4.5 0 0 1 0-8.5Z" />
  </>
));
export const ProductsIcon = brandIcon("ProductsIcon", 24, 1.6, (
  <>
      <path d="M12 3 20.5 7.5v9L12 21l-8.5-4.5v-9Z" />
      <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
      <path d="M16.3 12.2a3 3 0 0 1 0 4.6 3 3 0 0 1 0-4.6Z" />
  </>
));
export const CustomersIcon = brandIcon("CustomersIcon", 24, 1.6, (
  <>
      <path d="M9 3a4.5 4.5 0 0 1 0 7.5 4.5 4.5 0 0 1 0-7.5Z" />
      <path d="M2.5 20.5a6.5 6.5 0 0 1 13 0" />
      <path d="M17 5a3.5 3.5 0 0 1 0 6 3.5 3.5 0 0 1 0-6Z" />
      <path d="M17 14a5 5 0 0 1 4.5 5" />
  </>
));
export const PayoutIcon = brandIcon("PayoutIcon", 24, 1.6, (
  <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M12 8.5a4.5 4.5 0 0 1 0 7 4.5 4.5 0 0 1 0-7Z" />
      <path d="M6 12h.01M18 12h.01" />
  </>
));  // redrawn for 20–24px legibility
export const ReportsIcon = brandIcon("ReportsIcon", 24, 1.6, (
  <>
      <path d="M3.5 3.5v17h17" />
      <path d="M8.5 12a3.5 3.5 0 0 1 0 5.5 3.5 3.5 0 0 1 0-5.5Z" />
      <path d="M13 6.5a4.5 4.5 0 0 1 0 11 4.5 4.5 0 0 1 0-11Z" />
      <path d="M17.5 10a4 4 0 0 1 0 7.5 4 4 0 0 1 0-7.5Z" />
  </>
));
export const SettingsIcon = brandIcon("SettingsIcon", 24, 1.6, (
  <>
      <path d="M12 2a3 3 0 0 1 0 4.5 3 3 0 0 1 0-4.5Z" />
      <path d="M12 2a3 3 0 0 1 0 4.5 3 3 0 0 1 0-4.5Z" transform="rotate(60 12 12)" />
      <path d="M12 2a3 3 0 0 1 0 4.5 3 3 0 0 1 0-4.5Z" transform="rotate(120 12 12)" />
      <path d="M12 2a3 3 0 0 1 0 4.5 3 3 0 0 1 0-4.5Z" transform="rotate(180 12 12)" />
      <path d="M12 2a3 3 0 0 1 0 4.5 3 3 0 0 1 0-4.5Z" transform="rotate(240 12 12)" />
      <path d="M12 2a3 3 0 0 1 0 4.5 3 3 0 0 1 0-4.5Z" transform="rotate(300 12 12)" />
      <circle cx="12" cy="12" r="5.5" />
      <circle cx="12" cy="12" r="2" />
  </>
));  // redrawn for 20–24px legibility
export const AddIcon = brandIcon("AddIcon", 24, 1.6, (
  <>
      <path d="M12 4.5a40 40 0 0 1 0 15 40 40 0 0 1 0-15Z" />
      <path d="M12 4.5a40 40 0 0 1 0 15 40 40 0 0 1 0-15Z" transform="rotate(90 12 12)" />
  </>
));  // redrawn for 20–24px legibility
export const EditIcon = brandIcon("EditIcon", 24, 1.6, (
  <>
      <path d="M4.5 19.5l.8-3.8L15.6 5.4a2 2 0 0 1 2.9 0l.1.1a2 2 0 0 1 0 2.9L8.3 18.7Z" />
      <path d="M13.8 7.2l3 3" />
      <path d="M13 20.5h7" />
  </>
));  // redrawn for 20–24px legibility
export const DeleteIcon = brandIcon("DeleteIcon", 24, 1.6, (
  <>
      <path d="M4 6.5h16M9.5 6.5V4h5v2.5M6 6.5l1 14h10l1-14" />
      <path d="M12 10a4 4 0 0 1 0 7 4 4 0 0 1 0-7Z" />
  </>
));
export const FilterIcon = brandIcon("FilterIcon", 24, 1.6, (
  <>
      <path d="M3.5 4.5h17L14 12v6l-4 2.5V12Z" />
  </>
));
export const ExportIcon = brandIcon("ExportIcon", 24, 1.6, (
  <>
      <path d="M12 3a7 7 0 0 1 0 11 7 7 0 0 1 0-11Z" />
      <path d="m8.5 11 3.5 3.5 3.5-3.5M4 16.5v4h16v-4" />
  </>
));
export const ApproveIcon = brandIcon("ApproveIcon", 24, 1.6, (
  <>
      <path d="M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6Z" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
  </>
));
export const LogoutIcon = brandIcon("LogoutIcon", 24, 1.6, (
  <>
      <path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9" />
  </>
));

/** Order-placed moment: SuccessIcon with a soft gold glow that pulses once a second (still under reduced motion). */
export function SuccessGlow({ size = 96, className = "", ...rest }: BrandIconProps) {
  return (
    <span className={`brand-success-glow ${className}`} style={{ display: "inline-grid", color: "var(--brand-gold, #D6BA80)" }}>
      <SuccessIcon size={size} {...rest} />
    </span>
  );
}
