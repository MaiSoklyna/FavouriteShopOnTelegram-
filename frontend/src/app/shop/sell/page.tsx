"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { LoginGate } from "@/components/shop/LoginGate";
import { api } from "@/lib/api";
import type { SellerApplication } from "@/types";

const NAVY = "#103562";
const GOLD = "#71541A";
const GOLD_LIGHT = "#D6BA80";

const PROVINCES = [
  "Phnom Penh", "Banteay Meanchey", "Battambang", "Kampong Cham", "Kampong Chhnang",
  "Kampong Speu", "Kampong Thom", "Kampot", "Kandal", "Kep", "Koh Kong", "Kratie",
  "Mondulkiri", "Oddar Meanchey", "Pailin", "Preah Sihanouk", "Preah Vihear",
  "Prey Veng", "Pursat", "Ratanakiri", "Siem Reap", "Stung Treng", "Svay Rieng",
  "Takeo", "Tboung Khmum",
];

const STEPS = ["Seller type", "Registration", "Store setup", "Location", "Review"];

interface FormState {
  seller_type: "individual" | "company";
  full_name: string;
  email: string;
  phone: string;
  gender: string;
  date_of_birth: string;
  company_name: string;
  password: string;
  confirm_password: string;
  store_name: string;
  store_description: string;
  logo_url: string;
  province: string;
  district: string;
  commune: string;
  address_line1: string;
  address_line2: string;
  agree_terms: boolean;
}

const EMPTY: FormState = {
  seller_type: "individual",
  full_name: "", email: "", phone: "", gender: "", date_of_birth: "", company_name: "",
  password: "", confirm_password: "",
  store_name: "", store_description: "", logo_url: "",
  province: "", district: "", commune: "", address_line1: "", address_line2: "",
  agree_terms: false,
};

export default function SellPage() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--shop-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="sp-spin" style={{ width: 32, height: 32, border: `3px solid var(--shop-divider)`, borderTopColor: GOLD, borderRadius: "50%" }} />
        <style>{`.sp-spin{animation:spin .6s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }
  if (!user) return <div style={{ minHeight: "100vh", background: "var(--shop-bg)" }}><LoginGate><div /></LoginGate></div>;
  return <SellContent />;
}

function SellContent() {
  const router = useRouter();
  const { user } = useAuth();
  const [existing, setExisting] = useState<SellerApplication | null>(null);
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [logoPreview, setLogoPreview] = useState<string>("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Prefill name from the Telegram profile.
  useEffect(() => {
    const u = user as any;
    if (u) setForm((f) => ({ ...f, full_name: f.full_name || u.first_name || u.name || "" }));
  }, [user]);

  const loadExisting = useCallback(async () => {
    try {
      const res = await api.get<{ data: SellerApplication | null }>("/seller-applications/me");
      setExisting(res.data);
    } catch { /* none */ }
    finally { setChecking(false); }
  }, []);
  useEffect(() => { loadExisting(); }, [loadExisting]);

  function validateStep(): string {
    if (step === 1) {
      if (form.full_name.trim().length < 2) return "Enter your full name";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return "Enter a valid email";
      if (form.seller_type === "company" && !form.company_name.trim()) return "Company name is required for a business";
      if (form.password.length < 8) return "Password must be at least 8 characters";
      if (form.password !== form.confirm_password) return "Passwords don't match";
    }
    if (step === 2) {
      if (form.store_name.trim().length < 2) return "Enter your store name";
    }
    if (step === 3) {
      if (!form.province) return "Select your province";
      if (!form.address_line1.trim()) return "Enter your store address";
    }
    if (step === 4) {
      if (!form.agree_terms) return "Please agree to the Terms of Service";
    }
    return "";
  }

  function next() {
    const err = validateStep();
    if (err) { setError(err); return; }
    setError("");
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function back() { setError(""); setStep((s) => Math.max(s - 1, 0)); }

  async function submit() {
    const err = validateStep();
    if (err) { setError(err); return; }
    setSubmitting(true);
    setError("");
    try {
      await api.post("/seller-applications", {
        seller_type: form.seller_type,
        full_name: form.full_name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone || null,
        gender: form.gender || null,
        date_of_birth: form.date_of_birth || null,
        company_name: form.seller_type === "company" ? form.company_name.trim() : null,
        password: form.password,
        store_name: form.store_name.trim(),
        store_description: form.store_description || null,
        logo_url: form.logo_url || null,
        province: form.province || null,
        district: form.district || null,
        commune: form.commune || null,
        address_line1: form.address_line1 || null,
        address_line2: form.address_line2 || null,
        agree_terms: form.agree_terms,
      });
      await loadExisting();
    } catch (e: any) {
      setError(e.detail || "Failed to submit application");
    } finally {
      setSubmitting(false);
    }
  }

  async function onLogoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setError("Logo must be under 2 MB"); return; }
    setLogoPreview(URL.createObjectURL(file));
    setUploadingLogo(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.upload<{ logo_url: string }>("/seller-applications/logo", fd);
      set("logo_url", res.logo_url);
    } catch (err: any) {
      setError(err.detail || "Logo upload failed — please try again");
      setLogoPreview("");
    } finally {
      setUploadingLogo(false);
    }
  }

  // ── Status screen (already applied, unless previously rejected) ──
  if (checking) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--shop-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="sp-spin" style={{ width: 32, height: 32, border: `3px solid var(--shop-divider)`, borderTopColor: GOLD, borderRadius: "50%" }} />
        <style>{`.sp-spin{animation:spin .6s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }
  if (existing && existing.status !== "rejected") {
    return <StatusScreen app={existing} onBack={() => router.push("/shop/profile")} />;
  }

  // ── Multi-step form ──
  return (
    <div style={{ minHeight: "100vh", background: "var(--shop-bg)", paddingBottom: 96, fontFamily: "'Kantumruy Pro', sans-serif" }}>
      <Header
        title="Become a Seller"
        subtitle="Create your seller account in a few easy steps."
        onBack={step === 0 ? () => router.push("/shop/profile") : back}
      />

      {/* Progress */}
      <div style={{ padding: "16px 20px 4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              flex: 1, height: 4, borderRadius: 999,
              background: i <= step ? GOLD : "var(--shop-divider)",
              transition: "background .3s",
            }} />
          ))}
        </div>
        <p style={{ fontSize: 12, color: "var(--shop-muted)", margin: 0 }}>
          Step {step + 1} of {STEPS.length} · <span style={{ color: GOLD, fontWeight: 600 }}>{STEPS[step]}</span>
        </p>
      </div>

      <div style={{ padding: "12px 16px" }}>
        {existing?.status === "rejected" && step === 0 && (
          <div style={{ background: "#FFF4E5", border: "1px solid #FFD8A8", borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#A8520A", margin: 0 }}>Your previous application wasn&apos;t approved</p>
            {existing.review_note && <p style={{ fontSize: 12, color: "#7A4A1A", margin: "4px 0 0" }}>{existing.review_note}</p>}
            <p style={{ fontSize: 12, color: "#7A4A1A", margin: "4px 0 0" }}>You can update your details and apply again below.</p>
          </div>
        )}

        {step === 0 && <StepSellerType value={form.seller_type} onChange={(v) => set("seller_type", v)} />}
        {step === 1 && <StepKyc form={form} set={set} />}
        {step === 2 && <StepStore form={form} set={set} logoPreview={logoPreview} uploadingLogo={uploadingLogo} fileRef={fileRef} onLogoPick={onLogoPick} />}
        {step === 3 && <StepLocation form={form} set={set} />}
        {step === 4 && <StepReview form={form} set={set} />}

        {error && (
          <p style={{ color: "#DC2626", fontSize: 13, marginTop: 12, fontWeight: 500 }}>{error}</p>
        )}
      </div>

      {/* Sticky footer nav */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 110,
        background: "var(--shop-surface)", borderTop: "1px solid var(--shop-divider)",
        padding: "12px 16px calc(12px + var(--safe-bottom, 0px))",
        display: "flex", gap: 10, maxWidth: 480, margin: "0 auto",
      }}>
        {step > 0 && (
          <button onClick={back} style={btnSecondary}>Back</button>
        )}
        {step < STEPS.length - 1 ? (
          <button onClick={next} style={btnPrimary}>Continue</button>
        ) : (
          <button onClick={submit} disabled={submitting} style={{ ...btnPrimary, opacity: submitting ? 0.6 : 1 }}>
            {submitting ? "Submitting…" : "Submit application"}
          </button>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── Steps ─────────────────────────

function StepSellerType({ value, onChange }: { value: "individual" | "company"; onChange: (v: "individual" | "company") => void }) {
  const opts = [
    { key: "individual" as const, title: "Individual Seller", desc: "Sell as yourself. No business registration needed." },
    { key: "company" as const, title: "Registered Business", desc: "Sell as a registered Cambodian business." },
  ];
  return (
    <div>
      <SectionTitle title="What type of seller?" hint="This determines your verification. You can upgrade later." />
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {opts.map((o) => {
          const sel = value === o.key;
          return (
            <button key={o.key} onClick={() => onChange(o.key)} style={{
              textAlign: "left", padding: 16, borderRadius: 14, cursor: "pointer",
              border: sel ? `2px solid ${GOLD}` : "1.5px solid var(--shop-divider)",
              background: sel ? "var(--shop-primary-tint)" : "var(--shop-surface)",
              display: "flex", gap: 12, alignItems: "flex-start",
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: "50%", flexShrink: 0, marginTop: 2,
                border: sel ? `7px solid ${GOLD}` : "2px solid var(--shop-muted)",
                transition: "all .2s",
              }} />
              <div>
                <p style={{ fontSize: 15, fontWeight: 700, color: "var(--shop-black)", margin: 0 }}>{o.title}</p>
                <p style={{ fontSize: 13, color: "var(--shop-muted)", margin: "4px 0 0" }}>{o.desc}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepKyc({ form, set }: { form: FormState; set: <K extends keyof FormState>(k: K, v: FormState[K]) => void }) {
  return (
    <div>
      <SectionTitle title="Registration & KYC" hint="Make sure these details are accurate." />
      <Field label="Full Name"><Input value={form.full_name} onChange={(v) => set("full_name", v)} placeholder="e.g. Sovann Chea" /></Field>
      {form.seller_type === "company" && (
        <Field label="Company name"><Input value={form.company_name} onChange={(v) => set("company_name", v)} placeholder="e.g. Sovann Co., Ltd." /></Field>
      )}
      <Field label="Email"><Input type="email" value={form.email} onChange={(v) => set("email", v)} placeholder="e.g. sovann@gmail.com" /></Field>
      <Field label="Phone number"><Input type="tel" value={form.phone} onChange={(v) => set("phone", v)} placeholder="e.g. 012 34 56 789" /></Field>
      <div style={{ display: "flex", gap: 12 }}>
        <Field label="Gender" style={{ flex: 1 }}>
          <Select value={form.gender} onChange={(v) => set("gender", v)} placeholder="Select gender"
            options={["Male", "Female", "Other"]} />
        </Field>
        <Field label="Date of birth" style={{ flex: 1 }}>
          <Input type="date" value={form.date_of_birth} onChange={(v) => set("date_of_birth", v)} placeholder="Select date" />
        </Field>
      </div>
      <Field label="Password"><Input type="password" value={form.password} onChange={(v) => set("password", v)} placeholder="Min. 8 characters" /></Field>
      <Field label="Confirm Password"><Input type="password" value={form.confirm_password} onChange={(v) => set("confirm_password", v)} placeholder="Matching password" /></Field>
    </div>
  );
}

function StepStore({ form, set, logoPreview, uploadingLogo, fileRef, onLogoPick }: {
  form: FormState; set: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  logoPreview: string; uploadingLogo: boolean;
  fileRef: React.RefObject<HTMLInputElement>; onLogoPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div>
      <SectionTitle title="Set up your store" hint="Make a great first impression on your customers." />
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        <button onClick={() => !uploadingLogo && fileRef.current?.click()} style={{
          position: "relative",
          width: 88, height: 88, borderRadius: "50%", cursor: uploadingLogo ? "wait" : "pointer",
          border: `2px dashed ${GOLD_LIGHT}`, background: "var(--shop-primary-tint)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
          overflow: "hidden", padding: 0,
        }}>
          {logoPreview ? (
            <img src={logoPreview} alt="Logo" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: uploadingLogo ? 0.5 : 1 }} />
          ) : (
            <>
              <span style={{ fontSize: 22, color: GOLD }}>+</span>
              <span style={{ fontSize: 10, color: GOLD, fontWeight: 600 }}>Add Logo</span>
            </>
          )}
          {uploadingLogo && (
            <span className="sp-spin" style={{
              position: "absolute", width: 24, height: 24, borderRadius: "50%",
              border: "3px solid rgba(255,255,255,0.5)", borderTopColor: GOLD,
            }} />
          )}
          <input ref={fileRef} type="file" accept="image/*" onChange={onLogoPick} style={{ display: "none" }} />
        </button>
      </div>
      {(logoPreview || uploadingLogo) && (
        <p style={{ textAlign: "center", fontSize: 11, color: form.logo_url ? "#1E7A43" : "var(--shop-muted)", marginTop: -8, marginBottom: 12 }}>
          {uploadingLogo ? "Uploading logo…" : form.logo_url ? "✓ Logo uploaded" : "Tap to add your store logo"}
        </p>
      )}
      <style>{`.sp-spin{animation:spin .6s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <Field label="Store name"><Input value={form.store_name} onChange={(v) => set("store_name", v)} placeholder="Your store name" /></Field>
      <Field label="Store description (optional)">
        <textarea value={form.store_description} onChange={(e) => set("store_description", e.target.value)} rows={4}
          placeholder="Tell customers what makes your store special..."
          style={{ ...inputStyle, resize: "vertical" as const, fontFamily: "'Inter', sans-serif" }} />
      </Field>
    </div>
  );
}

function StepLocation({ form, set }: { form: FormState; set: <K extends keyof FormState>(k: K, v: FormState[K]) => void }) {
  return (
    <div>
      <SectionTitle title="Store location" hint="Used for shopping estimates and local delivery zones." />
      <Field label="Province"><Select value={form.province} onChange={(v) => set("province", v)} placeholder="Select province" options={PROVINCES} /></Field>
      <div style={{ display: "flex", gap: 12 }}>
        <Field label="District / khan" style={{ flex: 1 }}><Input value={form.district} onChange={(v) => set("district", v)} placeholder="District" /></Field>
        <Field label="Commune / sangkat" style={{ flex: 1 }}><Input value={form.commune} onChange={(v) => set("commune", v)} placeholder="Commune" /></Field>
      </div>
      <Field label="Address line 1"><Input value={form.address_line1} onChange={(v) => set("address_line1", v)} placeholder="Street, building, house number" /></Field>
      <Field label="Address line 2 (optional)"><Input value={form.address_line2} onChange={(v) => set("address_line2", v)} placeholder="Apartment, floor, landmark" /></Field>
    </div>
  );
}

function StepReview({ form, set }: { form: FormState; set: <K extends keyof FormState>(k: K, v: FormState[K]) => void }) {
  const rows: [string, string][] = [
    ["Seller type", form.seller_type === "company" ? "Registered Business" : "Individual Seller"],
    ["Full name", form.full_name],
    ...(form.seller_type === "company" ? [["Company", form.company_name] as [string, string]] : []),
    ["Email", form.email],
    ["Phone", form.phone || "—"],
    ["Store name", form.store_name],
    ["Location", [form.address_line1, form.commune, form.district, form.province].filter(Boolean).join(", ") || "—"],
  ];
  return (
    <div>
      <SectionTitle title="Review & submit" hint="Check your details before submitting." />
      <div style={{ background: "var(--shop-surface)", borderRadius: 14, padding: 16, boxShadow: "var(--shop-shadow)", marginBottom: 16 }}>
        {rows.map(([k, v], i) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderTop: i ? "1px solid var(--shop-divider)" : "none" }}>
            <span style={{ fontSize: 13, color: "var(--shop-muted)" }}>{k}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--shop-black)", textAlign: "right" }}>{v}</span>
          </div>
        ))}
      </div>
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
        <input type="checkbox" checked={form.agree_terms} onChange={(e) => set("agree_terms", e.target.checked)}
          style={{ width: 18, height: 18, marginTop: 1, accentColor: GOLD }} />
        <span style={{ fontSize: 13, color: "var(--shop-text)" }}>
          I agree to the <span style={{ color: GOLD, fontWeight: 600 }}>Terms of Service</span> and <span style={{ color: GOLD, fontWeight: 600 }}>Privacy Policy</span>
        </span>
      </label>
    </div>
  );
}

// ───────────────────────── Status screen ─────────────────────────

function StatusScreen({ app, onBack }: { app: SellerApplication; onBack: () => void }) {
  const approved = app.status === "approved";
  const stages = [
    { label: "Registration & KYC", done: true },
    { label: "Byme24 Approval", done: approved, current: !approved },
    { label: "Store goes live", done: approved },
  ];
  return (
    <div style={{ minHeight: "100vh", background: "var(--shop-bg)", paddingBottom: 40, fontFamily: "'Kantumruy Pro', sans-serif" }}>
      <Header title="Application Progress" subtitle={app.store_name} onBack={onBack} />
      <div style={{ padding: 16 }}>
        <div style={{
          background: approved ? "#E8F7EE" : "var(--shop-primary-tint)",
          border: `1px solid ${approved ? "#A7E0BD" : GOLD_LIGHT}`,
          borderRadius: 16, padding: 20, marginBottom: 16, textAlign: "center",
        }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>{approved ? "🎉" : "⏳"}</div>
          <p style={{ fontSize: 16, fontWeight: 700, color: approved ? "#1E7A43" : GOLD, margin: 0 }}>
            {approved ? "You're approved!" : "Under review"}
          </p>
          <p style={{ fontSize: 13, color: "var(--shop-text)", margin: "8px 0 0", lineHeight: 1.5 }}>
            {approved
              ? "Your shop is live. Open the bot and tap /start to access your shop owner menu — manage products, orders and analytics."
              : "Your application has been submitted. A Byme24 team member will review and contact you within 1–3 business days."}
          </p>
        </div>

        <div style={{ background: "var(--shop-surface)", borderRadius: 16, padding: 20, boxShadow: "var(--shop-shadow)" }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--shop-black)", marginBottom: 16, marginTop: 0 }}>Progress</h3>
          {stages.map((s, i) => (
            <div key={s.label} style={{ display: "flex", gap: 14 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700,
                  background: s.done ? "#2E7D32" : (s as any).current ? GOLD : "var(--shop-divider)",
                  color: s.done || (s as any).current ? "#fff" : "var(--shop-muted)",
                }}>{s.done ? "✓" : i + 1}</div>
                {i < stages.length - 1 && <div style={{ width: 2, height: 28, background: s.done ? "#2E7D32" : "var(--shop-divider)" }} />}
              </div>
              <div style={{ paddingBottom: 14 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: "var(--shop-black)", margin: 0 }}>{s.label}</p>
                <p style={{ fontSize: 12, color: "var(--shop-muted)", margin: "2px 0 0" }}>
                  {s.done ? "Completed" : (s as any).current ? "In progress" : "Pending"}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Shared UI ─────────────────────────

function Header({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void }) {
  return (
    <div style={{ background: NAVY, borderRadius: "0 0 20px 20px", padding: "16px 20px 22px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{
          width: 36, height: 36, borderRadius: 20, background: "rgba(234,239,243,0.2)", border: "none",
          cursor: "pointer", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0,
        }}>&#8592;</button>
        <div>
          <p style={{ fontSize: 16, fontWeight: 600, color: "#fff", margin: 0 }}>{title}</p>
          {subtitle && <p style={{ fontSize: 12, color: GOLD_LIGHT, margin: "2px 0 0" }}>{subtitle}</p>}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--shop-black)", margin: 0 }}>{title}</h2>
      {hint && <p style={{ fontSize: 13, color: "var(--shop-muted)", margin: "4px 0 0" }}>{hint}</p>}
    </div>
  );
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ marginBottom: 14, ...style }}>
      <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--shop-text)", marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "12px 14px", borderRadius: 12,
  border: "1.5px solid var(--shop-divider)", background: "var(--shop-surface)",
  color: "var(--shop-black)", fontSize: 14, outline: "none",
  fontFamily: "'Inter', sans-serif", boxSizing: "border-box",
};

function Input({ value, onChange, placeholder, type = "text" }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <input type={type} value={value} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => (e.target.style.borderColor = GOLD)}
      onBlur={(e) => (e.target.style.borderColor = "var(--shop-divider)")}
      style={inputStyle} />
  );
}

function Select({ value, onChange, placeholder, options }: { value: string; onChange: (v: string) => void; placeholder: string; options: string[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, color: value ? "var(--shop-black)" : "var(--shop-muted)", appearance: "none" as const }}>
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o} value={o} style={{ color: "#000" }}>{o}</option>)}
    </select>
  );
}

const btnPrimary: React.CSSProperties = {
  flex: 1, padding: 14, borderRadius: 12, border: "none",
  background: GOLD, color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer",
  fontFamily: "'Kantumruy Pro', sans-serif",
};
const btnSecondary: React.CSSProperties = {
  padding: "14px 22px", borderRadius: 12, border: "1.5px solid var(--shop-divider)",
  background: "transparent", color: "var(--shop-text)", fontWeight: 600, fontSize: 15, cursor: "pointer",
  fontFamily: "'Kantumruy Pro', sans-serif",
};
