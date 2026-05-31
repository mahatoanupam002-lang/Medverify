import React, { useState, useEffect, useMemo, useRef } from "react";

/* =====================================================================================
   MEDVERIFY — India Medical Practitioner Verification Platform
   -------------------------------------------------------------------------------------
   Stack intent (your usual): React + Firebase Auth + Firestore + Cloud Functions.
   This file is the FRONTEND with a PLUGGABLE VERIFICATION ADAPTER so it works whether
   or not NMC/NMR exposes a programmatic API.

   ⚠ REGISTRY REALITY (verify before launch):
   - Authoritative source = NMC National Medical Register (NMR) + State Medical Councils.
   - I am NOT certain NMR exposes a public REST API for automated lookup. As of my
     knowledge it is a web portal (search by name / reg no / year / council).
   - Therefore: verification is abstracted behind `verificationAdapter`. Swap the mock
     for (a) an official API if/when available, (b) a server-side scraper in a Cloud
     Function, or (c) human-assisted review queue. The UI does not change.

   ---- FIREBASE WIRING (uncomment in real build) ----
   // import { initializeApp } from "firebase/app";
   // import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
   // import { getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc,
   //          query, where, orderBy, serverTimestamp, updateDoc } from "firebase/firestore";
   // const app = initializeApp({ apiKey:"…", authDomain:"…", projectId:"…", … });
   // const auth = getAuth(app); const db = getFirestore(app);

   ---- FIRESTORE SCHEMA ----
   doctors/{regId}            { regNo, councilCode, name, qualification, regYear,
                                status:'active'|'suspended'|'expired',
                                verifiedSource:'nmr'|'state'|'manual', lastVerifiedAt,
                                claimedByUid?:string, claimStatus?:'unclaimed'|'pending'|'verified' }
   claims/{claimId}           { regId, uid, evidenceUrl, submittedAt, status:'pending'|'approved'|'rejected', reviewerUid? }
   lookups/{autoId}           { regId, queryText, uid?, at }   // audit trail / analytics
   reports/{autoId}           { subjectName, allegedRegNo?, reason, evidenceUrl?, reporterUid?, at, status }

   ---- SECURITY RULES (sketch) ----
   // doctors: read = public; write = only Cloud Function (admin) or verified claimant on own profile subset
   // claims:  create = signed-in; read/update = owner or admin
   // reports: create = anyone (rate-limited via App Check); read = admin only

   Negative-marking-free zone. This is verification, not an exam. :)
===================================================================================== */

/* ------------------------------------------------------------------ MOCK SEED DATA */
// In production these rows come from a verified ingest of NMR/state-council data.
const SEED_DOCTORS = [
  { regNo: "WB-2014-44871", councilCode: "WBMC", name: "Dr. Ananya Bhattacharya", qualification: "MBBS, MD (General Medicine)", regYear: 2014, status: "active", verifiedSource: "state", claimStatus: "verified" },
  { regNo: "DMC-2009-10233", councilCode: "DMC", name: "Dr. Rohan Mehta", qualification: "MBBS, MS (Orthopaedics)", regYear: 2009, status: "active", verifiedSource: "nmr", claimStatus: "unclaimed" },
  { regNo: "MMC-2019-77120", councilCode: "MMC", name: "Dr. Priya Nair", qualification: "MBBS, DNB (Paediatrics)", regYear: 2019, status: "active", verifiedSource: "state", claimStatus: "pending" },
  { regNo: "TNMC-2002-30119", councilCode: "TNMC", name: "Dr. Saravanan Iyer", qualification: "MBBS", regYear: 2002, status: "suspended", verifiedSource: "state", claimStatus: "unclaimed" },
  { regNo: "WB-1998-12044", councilCode: "WBMC", name: "Dr. Sunil Ghosh", qualification: "MBBS, MD (Psychiatry)", regYear: 1998, status: "expired", verifiedSource: "manual", claimStatus: "unclaimed" },
  { regNo: "KMC-2021-90551", councilCode: "KMC", name: "Dr. Lakshmi Menon", qualification: "MBBS", regYear: 2021, status: "active", verifiedSource: "nmr", claimStatus: "unclaimed" },
];
const COUNCILS = {
  WBMC: "West Bengal Medical Council", DMC: "Delhi Medical Council", MMC: "Maharashtra Medical Council",
  TNMC: "Tamil Nadu Medical Council", KMC: "Karnataka Medical Council",
};

/* --------------------------------------------------- PLUGGABLE VERIFICATION ADAPTER */
/* Replace the body of `verify()` with a real call. Keep the return shape identical. */
const verificationAdapter = {
  source: "MOCK",
  async verify({ regNo, name }) {
    await new Promise(r => setTimeout(r, 650)); // simulate network
    const q = (regNo || name || "").trim().toLowerCase();
    if (!q) return { matches: [] };
    const matches = SEED_DOCTORS.filter(d =>
      d.regNo.toLowerCase().includes(q) || d.name.toLowerCase().includes(q)
    );
    return { matches, source: this.source, checkedAt: new Date().toISOString() };

    /* REAL EXAMPLES:
       // (a) Official API (verify it exists first):
       // const res = await fetch(`/api/nmr/search?reg=${encodeURIComponent(regNo)}`);
       // return await res.json();
       // (b) Cloud Function scraper:
       // const res = await fetch(`https://us-central1-PROJ.cloudfunctions.net/nmrLookup`, {method:"POST", body: JSON.stringify({regNo,name})});
       // return await res.json();
    */
  },
};

/* ------------------------------------------------------------------------- HELPERS */
const STATUS_META = {
  active:    { label: "Registered & Active", color: "#1f7a4d", bg: "#e6f4ec", dot: "#22a866", icon: "✓" },
  suspended: { label: "Suspended",           color: "#9a2c2c", bg: "#fbeaea", dot: "#d44", icon: "!" },
  expired:   { label: "Registration Expired",color: "#8a6d1a", bg: "#fbf3df", dot: "#caa23a", icon: "○" },
  unknown:   { label: "No Record Found",     color: "#4a4a4a", bg: "#efeeec", dot: "#9a9a9a", icon: "?" },
};
const fmtDate = (iso) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

/* ========================================================================= APP */
export default function MedVerify() {
  const [tab, setTab] = useState("lookup");
  const [user, setUser] = useState(null); // mock auth; replace w/ onAuthStateChanged

  // mock sign-in
  const signIn = () => setUser({ uid: "u_demo", name: "Demo User", email: "demo@example.com", role: "doctor" });
  const signInAdmin = () => setUser({ uid: "u_admin", name: "Council Admin", email: "admin@nmc.demo", role: "admin" });
  const signOutFn = () => setUser(null);

  return (
    <div style={S.shell}>
      <Style />
      <Header user={user} tab={tab} setTab={setTab}
              signIn={signIn} signInAdmin={signInAdmin} signOut={signOutFn} />
      <main style={S.main}>
        {tab === "lookup" && <Lookup user={user} />}
        {tab === "claim"  && <Claim user={user} signIn={signIn} />}
        {tab === "report" && <Report user={user} />}
        {tab === "admin"  && <Admin user={user} />}
        {tab === "about"  && <About />}
      </main>
      <Footer />
    </div>
  );
}

/* ----------------------------------------------------------------------- HEADER */
function Header({ user, tab, setTab, signIn, signInAdmin, signOut }) {
  const tabs = [
    ["lookup", "Verify a Doctor"],
    ["claim", "Claim Your Profile"],
    ["report", "Report Impersonation"],
    ...(user?.role === "admin" ? [["admin", "Review Queue"]] : []),
    ["about", "How it works"],
  ];
  return (
    <header style={S.header}>
      <div style={S.brandRow}>
        <div style={S.logo}>
          <span style={S.logoMark}>⊕</span>
          <div>
            <div style={S.logoText}>MedVerify<span style={{color:"#c9a227"}}>.in</span></div>
            <div style={S.logoSub}>National practitioner verification · NMC / State Councils</div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {!user ? (
            <>
              <button style={S.ghostBtn} onClick={signIn}>Doctor sign in</button>
              <button style={S.ghostBtn} onClick={signInAdmin}>Admin</button>
            </>
          ) : (
            <div style={{display:"flex",gap:10,alignItems:"center"}}>
              <span style={S.userPill}>{user.name} · {user.role}</span>
              <button style={S.ghostBtn} onClick={signOut}>Sign out</button>
            </div>
          )}
        </div>
      </div>
      <nav style={S.nav}>
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ ...S.navBtn, ...(tab === k ? S.navBtnActive : {}) }}>
            {label}
          </button>
        ))}
      </nav>
    </header>
  );
}

/* ----------------------------------------------------------------------- LOOKUP */
function Lookup({ user }) {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState("regNo");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const run = async () => {
    if (!q.trim()) { setErr("Enter a registration number or name."); return; }
    setErr(""); setLoading(true); setResult(null);
    try {
      const payload = mode === "regNo" ? { regNo: q } : { name: q };
      const res = await verificationAdapter.verify(payload);
      setResult(res);
      // PROD: addDoc(collection(db,"lookups"), { regId:q, queryText:q, uid:user?.uid||null, at:serverTimestamp() });
    } catch (e) { setErr("Lookup failed. Try again."); }
    finally { setLoading(false); }
  };

  return (
    <section>
      <h1 style={S.h1}>Is this doctor real?</h1>
      <p style={S.lede}>
        Check any practitioner against registered records before you trust medical advice.
        A blue tick on Instagram is not a medical licence.
      </p>

      <div style={S.searchCard}>
        <div style={S.segmented}>
          {[["regNo","Registration No."],["name","Name"]].map(([k,l])=>(
            <button key={k} onClick={()=>setMode(k)}
              style={{...S.segBtn,...(mode===k?S.segBtnActive:{})}}>{l}</button>
          ))}
        </div>
        <div style={S.searchRow}>
          <input style={S.input} value={q} onChange={e=>setQ(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&run()}
            placeholder={mode==="regNo" ? "e.g. WB-2014-44871" : "e.g. Ananya Bhattacharya"} />
          <button style={S.primaryBtn} onClick={run} disabled={loading}>
            {loading ? "Checking…" : "Verify"}
          </button>
        </div>
        {err && <div style={S.errText}>{err}</div>}
        <div style={S.hintRow}>
          Try: <Chip onClick={()=>{setMode("regNo");setQ("WB-2014-44871");}}>active</Chip>
          <Chip onClick={()=>{setMode("regNo");setQ("TNMC-2002-30119");}}>suspended</Chip>
          <Chip onClick={()=>{setMode("regNo");setQ("WB-1998-12044");}}>expired</Chip>
          <Chip onClick={()=>{setMode("name");setQ("Imposter");}}>no record</Chip>
        </div>
      </div>

      {loading && <div style={S.skeleton} />}
      {result && <Results result={result} />}
    </section>
  );
}

function Results({ result }) {
  if (!result.matches.length) {
    const m = STATUS_META.unknown;
    return (
      <div style={{...S.resultCard, borderColor:m.dot}}>
        <Badge status="unknown" />
        <h3 style={S.resName}>No matching registration found</h3>
        <p style={S.resBody}>
          This does not prove the person is unqualified — records may be under a different
          name/number, or in a council not yet ingested. But it does mean you should ask for
          their registration number and re-check. Consider filing a report if they claim to be
          a doctor.
        </p>
      </div>
    );
  }
  return (
    <div style={{display:"grid",gap:14}}>
      <div style={S.metaLine}>
        {result.matches.length} record(s) · source: <b>{result.source}</b> · checked {fmtDate(result.checkedAt)}
      </div>
      {result.matches.map(d => <DoctorCard key={d.regNo} d={d} />)}
    </div>
  );
}

function DoctorCard({ d }) {
  const m = STATUS_META[d.status] || STATUS_META.unknown;
  return (
    <div style={{...S.resultCard, borderColor:m.dot}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
        <div>
          <h3 style={S.resName}>
            {d.name}
            {d.claimStatus === "verified" && <span title="Identity claimed & verified" style={S.verifiedTick}>✔ claimed</span>}
          </h3>
          <div style={S.resQual}>{d.qualification}</div>
        </div>
        <Badge status={d.status} />
      </div>
      <div style={S.kv}>
        <KV k="Registration No." v={d.regNo} mono />
        <KV k="Council" v={`${COUNCILS[d.councilCode] || d.councilCode}`} />
        <KV k="Year of registration" v={d.regYear} />
        <KV k="Verified via" v={d.verifiedSource.toUpperCase()} />
      </div>
      {d.status !== "active" && (
        <div style={{...S.warnBanner, background:m.bg, color:m.color}}>
          {d.status === "suspended"
            ? "This registration is currently suspended. Do not rely on this person for medical care."
            : "This registration has lapsed/expired. Verify renewal before trusting clinical advice."}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------- CLAIM FLOW */
function Claim({ user, signIn }) {
  const [regNo, setRegNo] = useState("");
  const [evidence, setEvidence] = useState("");
  const [sent, setSent] = useState(false);

  if (!user) {
    return (
      <Gate title="Claim your verified profile"
        body="Sign in to link your registration number to your identity and earn a verified badge that patients can trust."
        cta="Doctor sign in" onCta={signIn} />
    );
  }
  if (sent) {
    return <Notice icon="✓" title="Claim submitted"
      body="A council admin will verify your evidence against the register. You'll get the verified badge once approved." />;
  }
  return (
    <section style={{maxWidth:560}}>
      <h1 style={S.h1}>Claim your profile</h1>
      <p style={S.lede}>Link your registration to your account. We cross-check against the register before granting the badge.</p>
      <div style={S.formCard}>
        <Field label="Your registration number">
          <input style={S.input} value={regNo} onChange={e=>setRegNo(e.target.value)} placeholder="e.g. WB-2014-44871" />
        </Field>
        <Field label="Evidence (link to council certificate / govt ID upload)">
          <input style={S.input} value={evidence} onChange={e=>setEvidence(e.target.value)} placeholder="https://… (use Firebase Storage upload in prod)" />
        </Field>
        <button style={{...S.primaryBtn,width:"100%"}} disabled={!regNo}
          onClick={()=>{
            setSent(true);
            // PROD: addDoc(collection(db,"claims"),{regId:regNo,uid:user.uid,evidenceUrl:evidence,status:"pending",submittedAt:serverTimestamp()});
          }}>
          Submit claim for review
        </button>
        <p style={S.fineprint}>We never display your evidence publicly. Only verification status is shown.</p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------- REPORT */
function Report({ user }) {
  const [f, setF] = useState({ subjectName:"", allegedRegNo:"", reason:"", evidenceUrl:"" });
  const [sent, setSent] = useState(false);
  const upd = k => e => setF({ ...f, [k]: e.target.value });

  if (sent) return <Notice icon="✓" title="Report received"
    body="Thanks. Reports are reviewed by council admins. False reporting is itself an offence — we log reporter identity where available." />;

  return (
    <section style={{maxWidth:560}}>
      <h1 style={S.h1}>Report a medical impersonator</h1>
      <p style={S.lede}>Someone claiming to be a doctor without registration? Flag it. Attach evidence (screenshots, links).</p>
      <div style={S.formCard}>
        <Field label="Name / handle of the person *">
          <input style={S.input} value={f.subjectName} onChange={upd("subjectName")} placeholder="Name or @handle" />
        </Field>
        <Field label="Claimed registration number (if any)">
          <input style={S.input} value={f.allegedRegNo} onChange={upd("allegedRegNo")} placeholder="optional" />
        </Field>
        <Field label="What are they doing? *">
          <textarea style={{...S.input,minHeight:90,resize:"vertical"}} value={f.reason} onChange={upd("reason")}
            placeholder="e.g. selling prescriptions on Instagram, claiming to be an MD…" />
        </Field>
        <Field label="Evidence link">
          <input style={S.input} value={f.evidenceUrl} onChange={upd("evidenceUrl")} placeholder="https://…" />
        </Field>
        <button style={{...S.primaryBtn,width:"100%"}} disabled={!f.subjectName||!f.reason}
          onClick={()=>{
            setSent(true);
            // PROD: addDoc(collection(db,"reports"),{...f,reporterUid:user?.uid||null,at:serverTimestamp(),status:"new"});
          }}>
          Submit report
        </button>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- ADMIN */
function Admin({ user }) {
  // mock queue
  const [claims, setClaims] = useState([
    { id:"c1", regId:"MMC-2019-77120", uid:"u_priya", evidenceUrl:"https://drive/…", status:"pending" },
  ]);
  const [reports, setReports] = useState([
    { id:"r1", subjectName:"@dr.glowfix", allegedRegNo:"—", reason:"Selling 'detox drips', claims MBBS, no reg shown", status:"new" },
  ]);
  if (user?.role !== "admin") return <Notice icon="🔒" title="Admins only" body="Sign in with an admin account." />;

  const act = (setter, id, status) => setter(list => list.map(x => x.id===id ? {...x,status} : x));

  return (
    <section>
      <h1 style={S.h1}>Review queue</h1>
      <h3 style={S.h3}>Pending claims</h3>
      {claims.filter(c=>c.status==="pending").length===0 && <Empty text="No pending claims." />}
      {claims.map(c=>(
        <div key={c.id} style={S.queueRow}>
          <div>
            <b>{c.regId}</b> · uid {c.uid}<br/>
            <a href={c.evidenceUrl} style={S.link}>view evidence</a> · {c.status}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button style={S.okBtn} onClick={()=>act(setClaims,c.id,"approved")}>Approve</button>
            <button style={S.noBtn} onClick={()=>act(setClaims,c.id,"rejected")}>Reject</button>
          </div>
        </div>
      ))}
      <h3 style={{...S.h3,marginTop:28}}>Impersonation reports</h3>
      {reports.map(r=>(
        <div key={r.id} style={S.queueRow}>
          <div><b>{r.subjectName}</b> · reg {r.allegedRegNo}<br/><span style={{color:"#666"}}>{r.reason}</span> · {r.status}</div>
          <div style={{display:"flex",gap:8}}>
            <button style={S.okBtn} onClick={()=>act(setReports,r.id,"escalated")}>Escalate to council</button>
            <button style={S.noBtn} onClick={()=>act(setReports,r.id,"dismissed")}>Dismiss</button>
          </div>
        </div>
      ))}
    </section>
  );
}

/* -------------------------------------------------------------------------- ABOUT */
function About() {
  return (
    <section style={{maxWidth:680}}>
      <h1 style={S.h1}>How verification works</h1>
      <ol style={S.steps}>
        <li><b>Source of truth.</b> Records derive from the NMC National Medical Register and State Medical Councils. <i>Verify current API/portal access before launch — automated lookup may require a server-side adapter.</i></li>
        <li><b>Pluggable adapter.</b> The lookup calls one function. Today it's mock; swap in an official API, a Cloud Function scraper, or a human review queue without changing the UI.</li>
        <li><b>Self-claim + badge.</b> Doctors link their registration and submit evidence; admins approve, granting a verified badge.</li>
        <li><b>Crowd reports.</b> The public flags suspected impersonators; council admins triage and escalate.</li>
      </ol>
      <div style={S.disclaimer}>
        <b>Limits & honesty:</b> Absence of a record is not proof of fraud, and a record is not a
        guarantee of competence or current standing — councils update on their own cadence. Always
        treat this as one signal, not a verdict.
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- SMALL PIECES */
function Badge({ status }) {
  const m = STATUS_META[status] || STATUS_META.unknown;
  return <span style={{...S.badge, background:m.bg, color:m.color, borderColor:m.dot}}>
    <span style={{...S.badgeDot, background:m.dot}}>{m.icon}</span>{m.label}
  </span>;
}
const KV = ({k,v,mono}) => (
  <div><div style={S.kvK}>{k}</div><div style={{...S.kvV, fontFamily: mono?"'IBM Plex Mono',monospace":"inherit"}}>{v}</div></div>
);
const Chip = ({children,onClick}) => <button style={S.chip} onClick={onClick}>{children}</button>;
const Field = ({label,children}) => <label style={S.field}><span style={S.fieldLbl}>{label}</span>{children}</label>;
const Notice = ({icon,title,body}) => (
  <div style={S.notice}><div style={S.noticeIcon}>{icon}</div><h2 style={{margin:"0 0 6px"}}>{title}</h2><p style={{margin:0,color:"#555"}}>{body}</p></div>
);
const Gate = ({title,body,cta,onCta}) => (
  <div style={S.notice}><h2 style={{marginTop:0}}>{title}</h2><p style={{color:"#555"}}>{body}</p><button style={S.primaryBtn} onClick={onCta}>{cta}</button></div>
);
const Empty = ({text}) => <div style={{color:"#888",padding:"12px 0"}}>{text}</div>;

function Footer(){return <footer style={S.footer}>MedVerify · demo build · data is mock · not affiliated with NMC. Verify registry access before production use.</footer>;}

/* --------------------------------------------------------------------- STYLES */
function Style(){return <style>{`
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=IBM+Plex+Mono:wght@400;500&family=Newsreader:wght@400;500&display=swap');
  *{box-sizing:border-box} body{margin:0}
  input:focus,textarea:focus{outline:none;border-color:#1f7a4d !important;box-shadow:0 0 0 3px #1f7a4d22}
  button{cursor:pointer;font-family:inherit}
  @keyframes pulse{0%,100%{opacity:.5}50%{opacity:.9}}
`}</style>;}

const ink = "#1c1a17", paper = "#f4f1ea", line = "#dcd5c7", green = "#1f7a4d", gold = "#c9a227";
const S = {
  shell:{minHeight:"100vh",background:paper,color:ink,fontFamily:"'Newsreader',Georgia,serif"},
  header:{background:"#fffdf8",borderBottom:`1px solid ${line}`,padding:"0 0 0",position:"sticky",top:0,zIndex:10},
  brandRow:{maxWidth:980,margin:"0 auto",padding:"16px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12},
  logo:{display:"flex",gap:12,alignItems:"center"},
  logoMark:{fontSize:34,color:green,lineHeight:1},
  logoText:{fontFamily:"'Fraunces',serif",fontWeight:700,fontSize:24,letterSpacing:-.5},
  logoSub:{fontSize:12,color:"#7a7466",fontFamily:"'IBM Plex Mono',monospace"},
  nav:{maxWidth:980,margin:"0 auto",padding:"0 12px",display:"flex",gap:4,overflowX:"auto"},
  navBtn:{background:"none",border:"none",padding:"12px 14px",fontSize:15,color:"#6b6557",borderBottom:"2px solid transparent",fontFamily:"'Newsreader',serif",whiteSpace:"nowrap"},
  navBtnActive:{color:ink,borderBottom:`2px solid ${green}`,fontWeight:600},
  main:{maxWidth:980,margin:"0 auto",padding:"32px 20px 60px"},
  h1:{fontFamily:"'Fraunces',serif",fontSize:38,fontWeight:700,letterSpacing:-1,margin:"0 0 8px"},
  h3:{fontFamily:"'Fraunces',serif",fontSize:20,margin:"0 0 12px"},
  lede:{fontSize:18,color:"#5a544a",lineHeight:1.5,maxWidth:620,margin:"0 0 24px"},
  searchCard:{background:"#fffdf8",border:`1px solid ${line}`,borderRadius:14,padding:20,boxShadow:"0 1px 0 #00000008"},
  segmented:{display:"inline-flex",background:"#efeadd",borderRadius:9,padding:3,marginBottom:14},
  segBtn:{border:"none",background:"none",padding:"7px 16px",borderRadius:7,fontSize:14,color:"#6b6557"},
  segBtnActive:{background:"#fffdf8",color:ink,fontWeight:600,boxShadow:"0 1px 3px #0001"},
  searchRow:{display:"flex",gap:10},
  input:{flex:1,padding:"13px 14px",border:`1px solid ${line}`,borderRadius:10,fontSize:16,background:"#fff",fontFamily:"'Newsreader',serif",width:"100%"},
  primaryBtn:{background:green,color:"#fff",border:"none",borderRadius:10,padding:"13px 24px",fontSize:16,fontWeight:600},
  ghostBtn:{background:"none",border:`1px solid ${line}`,borderRadius:9,padding:"8px 14px",fontSize:14,color:ink},
  userPill:{fontSize:13,color:"#6b6557",fontFamily:"'IBM Plex Mono',monospace"},
  hintRow:{marginTop:12,fontSize:13,color:"#8a8474",display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"},
  chip:{background:"#efeadd",border:`1px solid ${line}`,borderRadius:20,padding:"4px 12px",fontSize:13,color:ink},
  errText:{color:"#9a2c2c",marginTop:10,fontSize:14},
  skeleton:{height:120,borderRadius:14,marginTop:20,background:"linear-gradient(90deg,#eee8da,#f4f1ea,#eee8da)",animation:"pulse 1.2s infinite"},
  metaLine:{fontSize:13,color:"#8a8474",fontFamily:"'IBM Plex Mono',monospace",marginTop:20},
  resultCard:{background:"#fffdf8",border:"1px solid",borderLeftWidth:5,borderRadius:12,padding:"18px 20px"},
  resName:{fontFamily:"'Fraunces',serif",fontSize:22,margin:"0 0 2px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"},
  resQual:{color:"#6b6557",fontSize:15},
  resBody:{color:"#5a544a",lineHeight:1.55,marginTop:8},
  verifiedTick:{fontSize:12,background:"#e6f4ec",color:green,border:`1px solid ${green}`,borderRadius:20,padding:"2px 9px",fontFamily:"'IBM Plex Mono',monospace"},
  badge:{display:"inline-flex",alignItems:"center",gap:7,border:"1px solid",borderRadius:30,padding:"6px 13px",fontSize:13,fontWeight:600,whiteSpace:"nowrap",height:"fit-content"},
  badgeDot:{width:18,height:18,borderRadius:"50%",color:"#fff",display:"grid",placeItems:"center",fontSize:11},
  kv:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:14,marginTop:16},
  kvK:{fontSize:11,textTransform:"uppercase",letterSpacing:1,color:"#9a9484",fontFamily:"'IBM Plex Mono',monospace"},
  kvV:{fontSize:16,marginTop:2},
  warnBanner:{padding:"10px 14px",borderRadius:9,marginTop:14,fontSize:14,fontWeight:500},
  formCard:{background:"#fffdf8",border:`1px solid ${line}`,borderRadius:14,padding:22,display:"grid",gap:16},
  field:{display:"grid",gap:6},
  fieldLbl:{fontSize:14,fontWeight:600,color:"#3a352c"},
  fineprint:{fontSize:12,color:"#9a9484",margin:0},
  steps:{fontSize:17,lineHeight:1.7,color:"#3a352c",paddingLeft:20,display:"grid",gap:12},
  disclaimer:{marginTop:24,background:"#fbf3df",border:`1px solid ${gold}`,borderRadius:10,padding:16,fontSize:15,lineHeight:1.55,color:"#5a4d1a"},
  notice:{background:"#fffdf8",border:`1px solid ${line}`,borderRadius:14,padding:32,textAlign:"center",maxWidth:520,margin:"20px auto"},
  noticeIcon:{fontSize:40,color:green,marginBottom:8},
  queueRow:{background:"#fffdf8",border:`1px solid ${line}`,borderRadius:10,padding:"14px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:10,fontSize:15,flexWrap:"wrap"},
  okBtn:{background:green,color:"#fff",border:"none",borderRadius:8,padding:"7px 14px",fontSize:14},
  noBtn:{background:"#fbeaea",color:"#9a2c2c",border:"1px solid #d44",borderRadius:8,padding:"7px 14px",fontSize:14},
  link:{color:green},
  footer:{borderTop:`1px solid ${line}`,padding:"20px",textAlign:"center",fontSize:12,color:"#9a9484",fontFamily:"'IBM Plex Mono',monospace"},
};
