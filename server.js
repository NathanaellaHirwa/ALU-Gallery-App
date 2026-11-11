const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const dataDir = path.resolve(process.env.ALU_DATA_DIR || path.join(root, 'data'));
const uploadDir = path.join(dataDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'alu-gallery.sqlite'));
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
db.exec(`
CREATE TABLE IF NOT EXISTS institutions (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, type TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('artist','institution_admin','gallery_admin')),
  institution_id INTEGER REFERENCES institutions(id), status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS artist_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  biography TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '',
  discipline TEXT NOT NULL DEFAULT '', interests TEXT NOT NULL DEFAULT '',
  portfolio TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '',
  email_public INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS artworks (
  id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id),
  institution_id INTEGER REFERENCES institutions(id), title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  image_path TEXT NOT NULL, category TEXT NOT NULL, medium TEXT NOT NULL DEFAULT '',
  dimensions TEXT NOT NULL DEFAULT '', creation_date TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '', copyright TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS exhibitions (
  id INTEGER PRIMARY KEY, organizer_institution_id INTEGER REFERENCES institutions(id),
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', theme TEXT NOT NULL DEFAULT '',
  cover_path TEXT NOT NULL DEFAULT '', starts_at TEXT NOT NULL DEFAULT '', ends_at TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL DEFAULT '', requirements TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY, artwork_id INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  exhibition_id INTEGER NOT NULL REFERENCES exhibitions(id), submitter_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'submitted', feedback TEXT NOT NULL DEFAULT '',
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, reviewed_at TEXT
);
CREATE TABLE IF NOT EXISTS collaborations (
  id INTEGER PRIMARY KEY, exhibition_id INTEGER REFERENCES exhibitions(id) ON DELETE CASCADE,
  institution_id INTEGER NOT NULL REFERENCES institutions(id), organizer_institution_id INTEGER REFERENCES institutions(id),
  message TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
  created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(exhibition_id, institution_id)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL, venue TEXT NOT NULL DEFAULT '', capacity INTEGER,
  status TEXT NOT NULL DEFAULT 'registration open', created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS event_registrations (
  id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(event_id,user_id)
);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY, subject TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(conversation_id,user_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, read_at TEXT
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL, read_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY, actor_id INTEGER REFERENCES users(id), action TEXT NOT NULL,
  record_type TEXT NOT NULL, record_id INTEGER, details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_artworks_public ON artworks(status,category);
CREATE INDEX IF NOT EXISTS idx_artwork_owner ON artworks(owner_id,institution_id);
CREATE INDEX IF NOT EXISTS idx_submissions_exhibition ON submissions(exhibition_id,status);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(starts_at,status);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id,created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id,read_at,created_at);
`);

const statements = {
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userById: db.prepare('SELECT id,email,full_name,role,institution_id,status FROM users WHERE id = ?'),
  activeAdmins: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='gallery_admin' AND status='active'"),
  newSession: db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)'),
  session: db.prepare('SELECT u.id,u.email,u.full_name,u.role,u.institution_id,u.status,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?'),
  log: db.prepare('INSERT INTO activity_logs(actor_id,action,record_type,record_id,details) VALUES(?,?,?,?,?)'),
};
const loginAttempts=new Map();
const roles = new Set(['artist','institution_admin','gallery_admin']);
const publicUser = u => ({ id:u.id, email:u.email, fullName:u.full_name, role:u.role, institutionId:u.institution_id, status:u.status });
const send = (res,status,payload,headers={}) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}); res.end(JSON.stringify(payload)); };
const fail = (res,status,message) => send(res,status,{error:message});
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
function cookie(req,name) { const part=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'=')); return part?decodeURIComponent(part.slice(name.length+1)):''; }
function userFor(req) { const token=cookie(req,'alu_session'); if(!token) return null; const session=statements.session.get(hash(token)); const institutionOk=session?.role!=='institution_admin'||db.prepare("SELECT status FROM institutions WHERE id=?").get(session.institution_id)?.status==='approved'; if(!session||session.expires_at<Date.now()||session.status!=='active'||!institutionOk){ if(session) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token)); return null; } return session; }
function requireUser(req,res,allowed=roles) { const u=userFor(req); if(!u){fail(res,401,'Sign in to continue.');return null;} if(!allowed.has(u.role)){fail(res,403,'You do not have permission for this action.');return null;} if(u.status!=='active'){fail(res,403,'This account is awaiting approval.');return null;} return u; }
function audit(user,action,type,id,details='') { statements.log.run(user?.id??null,action,type,id,String(details).slice(0,500)); }
function notify(userId,body) { if(userId) db.prepare('INSERT INTO notifications(user_id,body) VALUES(?,?)').run(userId,String(body).slice(0,500)); }
async function body(req,limit=7*1024*1024) { let size=0,chunks=[]; for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(new Error('Request is too large.'),{status:413});chunks.push(chunk);} try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw Object.assign(new Error('Invalid JSON body.'),{status:400});} }
const allowedImage = new Map([['image/jpeg',['jpg',Buffer.from([0xff,0xd8,0xff])]],['image/png',['png',Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])]],['image/webp',['webp',Buffer.from('RIFF')]]]);
function imageSave(dataUrl) {
  const match=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl||'');
  if(!match) throw Object.assign(new Error('Use a JPEG, PNG, or WebP image.'),{status:400});
  const type=match[1], bytes=Buffer.from(match[2],'base64');
  if(bytes.length>2*1024*1024) throw Object.assign(new Error('Images must be 2 MB or smaller.'),{status:413});
  const spec=allowedImage.get(type), valid=bytes.subarray(0,spec[1].length).equals(spec[1])&&(type!=='image/webp'||bytes.subarray(8,12).equals(Buffer.from('WEBP')));if(!valid) throw Object.assign(new Error('Image content did not match its file type.'),{status:400});
  const name=crypto.randomUUID()+'.'+spec[0]; fs.writeFileSync(path.join(uploadDir,name),bytes,{flag:'wx'}); return '/uploads/'+name;
}
function rows(sql,...params) { return db.prepare(sql).all(...params); }
function bootstrap(user) {
  const admin=user?.role==='gallery_admin';
  const institutionId=user?.institution_id||0;
  let artworkFilter="a.status='published'";
  if(admin) artworkFilter='1=1';
  else if(user?.role==='artist') artworkFilter=`(a.status='published' OR a.owner_id=${Number(user.id)})`;
  else if(user?.role==='institution_admin') artworkFilter=`(a.status='published' OR a.institution_id=${Number(institutionId)})`;
  return {
    user:user?publicUser(user):null,
    setupAvailable:statements.activeAdmins.get().n===0&&!!process.env.ALU_SETUP_KEY,
    artists:rows("SELECT u.id,u.full_name AS fullName,CASE WHEN p.email_public=1 THEN u.email ELSE '' END AS email,p.biography,p.country,p.discipline,p.interests,p.portfolio,p.contact,COUNT(a.id) AS works FROM users u JOIN artworks a ON a.owner_id=u.id AND a.status='published' LEFT JOIN artist_profiles p ON p.user_id=u.id GROUP BY u.id ORDER BY u.full_name LIMIT 300"),
    artworks: rows(`SELECT a.id,a.owner_id AS ownerId,a.institution_id AS institutionId,a.title,a.description,CASE WHEN a.image_path LIKE 'https://%' THEN a.image_path ELSE '/api/artworks/'||a.id||'/image' END AS image,a.category,a.medium,a.dimensions,a.creation_date AS creationDate,a.tags,a.copyright,a.status,u.full_name AS artist,i.name AS institution FROM artworks a JOIN users u ON u.id=a.owner_id LEFT JOIN institutions i ON i.id=a.institution_id WHERE ${artworkFilter} ORDER BY a.created_at DESC LIMIT 300`),
    exhibitions: rows(`SELECT id,title,description,theme,starts_at AS date,ends_at,venue AS place,requirements,status FROM exhibitions WHERE ${admin?'1=1':"status IN ('published','open for submissions','upcoming','ongoing')"} ORDER BY starts_at DESC LIMIT 100`),
    institutions: rows(`SELECT i.id,i.name,i.type,i.location,i.description,i.website,i.status,(SELECT COUNT(*) FROM users u WHERE u.institution_id=i.id AND u.role='artist') AS artists FROM institutions i WHERE ${admin?'1=1':"i.status='approved'"} ORDER BY i.name LIMIT 200`),
    events: rows(`SELECT e.id,e.title,e.description,e.kind,e.starts_at AS date,e.venue AS place,e.capacity,e.status,e.created_by,COUNT(r.id) AS registrations,${user?`SUM(CASE WHEN r.user_id=${Number(user.id)} THEN 1 ELSE 0 END)`:'0'} AS registered FROM events e LEFT JOIN event_registrations r ON r.event_id=e.id WHERE ${admin?'1=1':"e.status NOT IN ('draft','cancelled')"} GROUP BY e.id ORDER BY e.starts_at LIMIT 200`),
    submissions:user?rows(`SELECT s.id,a.title,u.full_name AS artist,e.title AS exhibition,s.status,s.feedback,s.submitted_at AS date,s.artwork_id FROM submissions s JOIN artworks a ON a.id=s.artwork_id JOIN users u ON u.id=s.submitter_id JOIN exhibitions e ON e.id=s.exhibition_id WHERE ${admin?'1=1':user.role==='institution_admin'?'a.institution_id='+Number(institutionId):'s.submitter_id='+Number(user.id)} ORDER BY s.submitted_at DESC LIMIT 300`):[],
    collaborations:user?rows(`SELECT c.id,c.exhibition_id,c.institution_id,c.organizer_institution_id,c.message,c.message AS detail,'Exhibition partnership' AS type,c.status,i.name AS institution,e.title AS exhibition FROM collaborations c JOIN institutions i ON i.id=c.institution_id LEFT JOIN exhibitions e ON e.id=c.exhibition_id WHERE ${admin?'1=1':user.role==='institution_admin'?'(c.institution_id='+Number(institutionId)+' OR c.organizer_institution_id='+Number(institutionId)+')':'1=0'} ORDER BY c.created_at DESC LIMIT 200`):[],
    notifications:user?rows('SELECT id,body AS text,read_at,created_at AS date FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100',user.id):[],
    reports:admin?{
      users:db.prepare("SELECT COUNT(*) n FROM users WHERE status<>'demo'").get().n,
      artists:db.prepare("SELECT COUNT(*) n FROM users WHERE role='artist' AND status<>'demo'").get().n,
      institutions:db.prepare("SELECT COUNT(*) n FROM institutions WHERE status='approved'").get().n,
      submissions:db.prepare('SELECT COUNT(*) n FROM submissions').get().n,
      pending:db.prepare("SELECT COUNT(*) n FROM submissions WHERE status IN ('submitted','under review')").get().n,
      publishedArtwork:db.prepare("SELECT COUNT(*) n FROM artworks WHERE status='published'").get().n,
    }:null
  };
}
function safeStatic(pathname) {
  let decoded; try{decoded=decodeURIComponent(pathname);}catch{return null;}
  const relative=decoded==='/'?'index.html':path.normalize(decoded.replace(/^[/\\]+/,''));
  const publicFiles=new Set(['index.html','enhancements.js']);
  if(!publicFiles.has(relative))return null;
  const file=path.resolve(root,relative), check=path.relative(root,file);
  return check.startsWith('..')||path.isAbsolute(check)?null:file;
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'), pathname=url.pathname;
  try {
    if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&req.headers.origin){let origin;try{origin=new URL(req.headers.origin);}catch{return fail(res,403,'Request origin is not allowed.');}if(origin.host!==req.headers.host)return fail(res,403,'Request origin is not allowed.');}
    if(req.method==='GET'&&pathname==='/api/bootstrap') return send(res,200,bootstrap(userFor(req)));
    if(req.method==='GET'&&pathname==='/api/health') return send(res,200,{ok:true,storage:'sqlite',setupAvailable:statements.activeAdmins.get().n===0&&!!process.env.ALU_SETUP_KEY});
    if(req.method==='GET'&&/^\/api\/artworks\/\d+\/image$/.test(pathname)){
      const id=Number(pathname.split('/')[3]),art=db.prepare('SELECT id,owner_id,institution_id,status,image_path FROM artworks WHERE id=?').get(id);if(!art)return fail(res,404,'Artwork not found.');const u=userFor(req);if(art.status!=='published'&&(!u||(u.role!=='gallery_admin'&&art.owner_id!==u.id&&(!art.institution_id||art.institution_id!==u.institution_id))))return fail(res,404,'Artwork not found.');const file=path.join(uploadDir,path.basename(art.image_path));fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}const ext=path.extname(file),type=ext==='.png'?'image/png':ext==='.webp'?'image/webp':'image/jpeg';res.writeHead(200,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':art.status==='published'?'public, max-age=3600':'private, no-store'});res.end(data);});return;
    }
    if(req.method==='POST'&&pathname==='/api/register'){
      const d=await body(req,12000), email=String(d.email||'').trim().toLowerCase(), name=String(d.fullName||'').trim(), password=String(d.password||''), role=d.role;
      if(!/^\S+@\S+\.\S+$/.test(email)||name.length<2||name.length>100||password.length<12||password.length>200||!['artist','institution_admin'].includes(role)) return fail(res,400,'Enter a valid email, full name, role, and password of at least 12 characters.');
      const salt=crypto.randomBytes(16).toString('hex'), hashPassword=crypto.scryptSync(password,salt,64).toString('hex');let institutionId=null,status='active';
      if(role==='institution_admin'){
        const institution=String(d.institutionName||'').trim(),type=String(d.institutionType||'University').trim(),location=String(d.location||'').trim();
        if(institution.length<2)return fail(res,400,'Enter the institution name.');
        const result=db.prepare("INSERT INTO institutions(name,type,location,status) VALUES(?,?,?,'pending')").run(institution,type,location); institutionId=Number(result.lastInsertRowid); status='pending';
      } else if(role==='artist'&&d.institutionId){institutionId=Number(d.institutionId);if(!db.prepare("SELECT id FROM institutions WHERE id=? AND status='approved'").get(institutionId))return fail(res,400,'Choose an approved institution or leave affiliation blank.');}
      try{const result=db.prepare('INSERT INTO users(email,full_name,password_salt,password_hash,role,institution_id,status) VALUES(?,?,?,?,?,?,?)').run(email,name,salt,hashPassword,role,institutionId,status);if(role==='artist')db.prepare('INSERT INTO artist_profiles(user_id) VALUES(?)').run(Number(result.lastInsertRowid));audit({id:Number(result.lastInsertRowid)},'register','user',Number(result.lastInsertRowid));return send(res,201,{user:publicUser(statements.userById.get(Number(result.lastInsertRowid))),message:status==='pending'?'Institution registration received and awaits administrator approval.':'Account created. Sign in to continue.'});}
      catch(err){if(institutionId)db.prepare('DELETE FROM institutions WHERE id=?').run(institutionId);if(String(err.message).includes('UNIQUE'))return fail(res,409,'An account with that email or institution name already exists.');throw err;}
    }
    if(req.method==='POST'&&pathname==='/api/login'){
      const ip=req.socket.remoteAddress||'local',attempt=loginAttempts.get(ip)||{count:0,at:Date.now()};if(Date.now()-attempt.at>60000){attempt.count=0;attempt.at=Date.now();}if(attempt.count>=10)return fail(res,429,'Too many sign-in attempts. Try again in one minute.');
      const d=await body(req,8000),email=String(d.email||'').trim().toLowerCase(),password=String(d.password||'').slice(0,200),u=statements.userByEmail.get(email),salt=u?.password_salt||'alu-gallery-login-check';
      const computed=crypto.scryptSync(password,salt,64),correct=!!u&&crypto.timingSafeEqual(computed,Buffer.from(u.password_hash,'hex'));if(!correct){attempt.count++;attempt.at=Date.now();loginAttempts.set(ip,attempt);return fail(res,401,'Email or password is incorrect.');}loginAttempts.delete(ip);
      if(u.status!=='active'||(u.institution_id&&db.prepare('SELECT status FROM institutions WHERE id=?').get(u.institution_id)?.status!=='approved'&&u.role==='institution_admin'))return fail(res,403,'This account is awaiting administrator approval.');
      const token=crypto.randomBytes(32).toString('base64url'),expires=Date.now()+7*24*60*60*1000;statements.newSession.run(hash(token),u.id,expires);const secure=req.socket.encrypted?'; Secure':'';return send(res,200,{user:publicUser(u)},{'Set-Cookie':`alu_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure}`});
    }
    if(req.method==='POST'&&pathname==='/api/logout'){
      const token=cookie(req,'alu_session');if(token)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token));return send(res,200,{ok:true},{'Set-Cookie':'alu_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
    }
    if(req.method==='GET'&&pathname==='/api/me'){const u=userFor(req);return send(res,200,{user:u?publicUser(u):null});}
    if(req.method==='GET'&&pathname==='/api/profile'){
      const u=requireUser(req,res);if(!u)return;const profile=u.role==='artist'?db.prepare('SELECT biography,country,discipline,interests,portfolio,contact,email_public AS emailPublic FROM artist_profiles WHERE user_id=?').get(u.id)||{}:{};const institution=u.institution_id?db.prepare('SELECT id,name,type,location,description,website FROM institutions WHERE id=?').get(u.institution_id):null;return send(res,200,{user:publicUser(u),profile,institution});
    }
    if(req.method==='PATCH'&&pathname==='/api/profile'){
      const u=requireUser(req,res);if(!u)return;const d=await body(req,20000);if(d.fullName!==undefined){const name=String(d.fullName).trim();if(name.length<2||name.length>100)return fail(res,400,'Name must be between 2 and 100 characters.');db.prepare('UPDATE users SET full_name=? WHERE id=?').run(name,u.id);}if(d.email!==undefined){const email=String(d.email).trim().toLowerCase();if(!/^\S+@\S+\.\S+$/.test(email))return fail(res,400,'Enter a valid email address.');try{db.prepare('UPDATE users SET email=? WHERE id=?').run(email,u.id);}catch{return fail(res,409,'That email address is already in use.');}}if(u.role==='artist'){db.prepare('INSERT INTO artist_profiles(user_id) VALUES(?) ON CONFLICT(user_id) DO NOTHING').run(u.id);db.prepare('UPDATE artist_profiles SET biography=?,country=?,discipline=?,interests=?,portfolio=?,contact=?,email_public=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(String(d.biography||'').slice(0,3000),String(d.country||'').slice(0,100),String(d.discipline||'').slice(0,150),String(d.interests||'').slice(0,500),String(d.portfolio||'').slice(0,300),String(d.contact||'').slice(0,300),d.emailPublic?1:0,u.id);}if(u.role==='institution_admin'&&u.institution_id){const fields={institutionName:'name',institutionType:'type',location:'location',description:'description',website:'website'},sets=[],values=[];for(const [key,column]of Object.entries(fields))if(d[key]!==undefined){sets.push(`${column}=?`);values.push(String(d[key]).slice(0,3000));}if(sets.length){values.push(u.institution_id);db.prepare(`UPDATE institutions SET ${sets.join(',')} WHERE id=?`).run(...values);}}audit(u,'update','profile',u.id);return send(res,200,{ok:true});
    }
    if(req.method==='POST'&&pathname==='/api/setup-admin'){
      const expected=process.env.ALU_SETUP_KEY;if(!expected)return fail(res,503,'Set ALU_SETUP_KEY before creating the first administrator.');
      if(statements.activeAdmins.get().n)return fail(res,409,'A gallery administrator already exists.');
      const d=await body(req,12000),provided=Buffer.from(String(d.setupKey||'')),secret=Buffer.from(expected);if(provided.length!==secret.length||!crypto.timingSafeEqual(provided,secret))return fail(res,403,'Setup key is incorrect.');
      const email=String(d.email||'').trim().toLowerCase(),name=String(d.fullName||'').trim(),password=String(d.password||'');if(!/^\S+@\S+\.\S+$/.test(email)||name.length<2||password.length<12)return fail(res,400,'Enter a valid email, name, and password of at least 12 characters.');
      const salt=crypto.randomBytes(16).toString('hex'),pw=crypto.scryptSync(password,salt,64).toString('hex'),r=db.prepare("INSERT INTO users(email,full_name,password_salt,password_hash,role,status) VALUES(?,?,?,?,'gallery_admin','active')").run(email,name,salt,pw);return send(res,201,{user:publicUser(statements.userById.get(Number(r.lastInsertRowid)))});
    }
    if(req.method==='POST'&&pathname==='/api/artworks'){
      const u=requireUser(req,res,new Set(['artist','institution_admin']));if(!u)return;const d=await body(req);const title=String(d.title||'').trim(),category=String(d.category||'').trim();if(title.length<2||title.length>180||!category)return fail(res,400,'Artwork title and discipline are required.');
      const image=imageSave(d.imageData);const r=db.prepare('INSERT INTO artworks(owner_id,institution_id,title,description,image_path,category,medium,dimensions,creation_date,tags,copyright,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(u.id,u.institution_id,title,String(d.description||'').slice(0,5000),image,category,String(d.medium||'').slice(0,150),String(d.dimensions||'').slice(0,120),String(d.creationDate||'').slice(0,30),String(d.tags||'').slice(0,500),String(d.copyright||'').slice(0,500),'pending');audit(u,'create','artwork',Number(r.lastInsertRowid));return send(res,201,{id:Number(r.lastInsertRowid),status:'pending'});
    }
    if(req.method==='PATCH'&&/^\/api\/artworks\/\d+$/.test(pathname)){
      const u=requireUser(req,res,new Set(['artist','institution_admin','gallery_admin']));if(!u)return;const id=Number(pathname.split('/').at(-1)),art=db.prepare('SELECT * FROM artworks WHERE id=?').get(id);if(!art)return fail(res,404,'Artwork not found.');if(u.role!=='gallery_admin'&&art.owner_id!==u.id&&(!art.institution_id||art.institution_id!==u.institution_id))return fail(res,403,'You can only edit artwork owned by your account or institution.');const d=await body(req),fields={title:'title',description:'description',category:'category',medium:'medium',dimensions:'dimensions',creationDate:'creation_date',tags:'tags',copyright:'copyright'},sets=[],values=[];for(const [key,column]of Object.entries(fields))if(d[key]!==undefined){const value=String(d[key]).trim();if(key==='title'&&(value.length<2||value.length>180))return fail(res,400,'Artwork title must be between 2 and 180 characters.');if(key==='category'&&!value)return fail(res,400,'Artwork discipline is required.');sets.push(`${column}=?`);values.push(value.slice(0,key==='description'?5000:500));}if(d.imageData){const image=imageSave(d.imageData);sets.push('image_path=?');values.push(image);}if(!sets.length)return fail(res,400,'No artwork changes were provided.');values.push(id);db.prepare(`UPDATE artworks SET ${sets.join(',')} WHERE id=?`).run(...values);audit(u,'update','artwork',id);return send(res,200,{ok:true});
    }
    if(req.method==='DELETE'&&/^\/api\/artworks\/\d+$/.test(pathname)){
      const u=requireUser(req,res,new Set(['artist','institution_admin','gallery_admin']));if(!u)return;const id=Number(pathname.split('/').at(-1)),art=db.prepare('SELECT * FROM artworks WHERE id=?').get(id);if(!art)return fail(res,404,'Artwork not found.');if(u.role!=='gallery_admin'&&art.owner_id!==u.id&&(!art.institution_id||art.institution_id!==u.institution_id))return fail(res,403,'You can only remove artwork owned by your account or institution.');db.prepare('DELETE FROM artworks WHERE id=?').run(id);try{fs.unlinkSync(path.join(uploadDir,path.basename(art.image_path)));}catch{}audit(u,'delete','artwork',id);return send(res,200,{ok:true});
    }
    if(req.method==='POST'&&pathname==='/api/exhibitions'){
      const u=requireUser(req,res,new Set(['gallery_admin']));if(!u)return;const d=await body(req),title=String(d.title||'').trim();if(title.length<2)return fail(res,400,'Exhibition title is required.');const r=db.prepare('INSERT INTO exhibitions(organizer_institution_id,title,description,theme,starts_at,ends_at,venue,requirements,status,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)').run(d.institutionId||null,title,String(d.description||'').slice(0,5000),String(d.theme||''),String(d.startsAt||''),String(d.endsAt||''),String(d.venue||''),String(d.requirements||''),String(d.status||'draft'),u.id);audit(u,'create','exhibition',Number(r.lastInsertRowid));return send(res,201,{id:Number(r.lastInsertRowid)});
    }
    if(req.method==='PATCH'&&/^\/api\/exhibitions\/\d+$/.test(pathname)){
      const u=requireUser(req,res,new Set(['gallery_admin']));if(!u)return;const id=Number(pathname.split('/').at(-1)),d=await body(req),existing=db.prepare('SELECT id FROM exhibitions WHERE id=?').get(id);if(!existing)return fail(res,404,'Exhibition not found.');const fields={title:'title',description:'description',theme:'theme',startsAt:'starts_at',endsAt:'ends_at',venue:'venue',requirements:'requirements',status:'status'},sets=[],values=[];for(const [key,column] of Object.entries(fields))if(d[key]!==undefined){let value=String(d[key]);if(key==='status'&&!['draft','upcoming','open for submissions','published','ongoing','completed','archived'].includes(value))return fail(res,400,'Invalid exhibition status.');if(key==='title'&&value.trim().length<2)return fail(res,400,'Exhibition title is required.');sets.push(`${column}=?`);values.push(value.slice(0,5000));}if(!sets.length)return fail(res,400,'No editable exhibition fields were provided.');values.push(id);db.prepare(`UPDATE exhibitions SET ${sets.join(',')} WHERE id=?`).run(...values);audit(u,'update','exhibition',id,d.status||'details');return send(res,200,{ok:true});
    }
    if(req.method==='POST'&&pathname==='/api/institutions'){
      const u=requireUser(req,res,new Set(['gallery_admin']));if(!u)return;const d=await body(req),name=String(d.name||'').trim(),type=String(d.type||'').trim();if(name.length<2||type.length<2)return fail(res,400,'Institution name and type are required.');try{const r=db.prepare('INSERT INTO institutions(name,type,location,description,website,status) VALUES(?,?,?,?,?,?)').run(name,type,String(d.location||''),String(d.description||''),String(d.website||''),'pending');audit(u,'create','institution',Number(r.lastInsertRowid));return send(res,201,{id:Number(r.lastInsertRowid),status:'pending'});}catch(err){if(String(err.message).includes('UNIQUE'))return fail(res,409,'This institution is already registered.');throw err;}
    }
    if(req.method==='POST'&&pathname==='/api/submissions'){
      const u=requireUser(req,res,new Set(['artist','institution_admin']));if(!u)return;const d=await body(req);const artwork=db.prepare('SELECT * FROM artworks WHERE id=? AND (owner_id=? OR institution_id=?)').get(Number(d.artworkId),u.id,u.institution_id||-1);if(!artwork)return fail(res,404,'Artwork was not found in your account.');const exhibition=db.prepare("SELECT id FROM exhibitions WHERE id=? AND status='open for submissions'").get(Number(d.exhibitionId));if(!exhibition)return fail(res,400,'This exhibition is not accepting submissions.');const r=db.prepare('INSERT INTO submissions(artwork_id,exhibition_id,submitter_id) VALUES(?,?,?)').run(artwork.id,exhibition.id,u.id);notify((db.prepare("SELECT id FROM users WHERE role='gallery_admin' AND status='active' ORDER BY id LIMIT 1").get()||{}).id,`New artwork submission: ${artwork.title}`);audit(u,'submit','submission',Number(r.lastInsertRowid));return send(res,201,{id:Number(r.lastInsertRowid),status:'submitted'});
    }
    if(req.method==='PATCH'&&/^\/api\/submissions\/\d+$/.test(pathname)){
      const u=requireUser(req,res,new Set(['gallery_admin']));if(!u)return;const id=Number(pathname.split('/').at(-1)),d=await body(req);if(!['under review','changes requested','approved','rejected'].includes(d.status))return fail(res,400,'Invalid review status.');const record=db.prepare('SELECT s.id,s.submitter_id,a.id AS artwork_id,a.title FROM submissions s JOIN artworks a ON a.id=s.artwork_id WHERE s.id=?').get(id);if(!record)return fail(res,404,'Submission not found.');db.prepare('UPDATE submissions SET status=?,feedback=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?').run(d.status,String(d.feedback||'').slice(0,2000),id);if(d.status==='approved')db.prepare("UPDATE artworks SET status='published' WHERE id=?").run(record.artwork_id);if(d.status==='rejected')db.prepare("UPDATE artworks SET status='rejected' WHERE id=?").run(record.artwork_id);notify(record.submitter_id,`${record.title}: ${d.status}.`);audit(u,'review','submission',id,d.status);return send(res,200,{ok:true});
    }
    if(req.method==='POST'&&pathname==='/api/events'){
      const u=requireUser(req,res,new Set(['gallery_admin','institution_admin']));if(!u)return;const d=await body(req),title=String(d.title||'').trim();if(title.length<2||!d.startsAt)return fail(res,400,'Event title and date are required.');const r=db.prepare('INSERT INTO events(title,description,kind,starts_at,venue,capacity,status,created_by) VALUES(?,?,?,?,?,?,?,?)').run(title,String(d.description||''),String(d.kind||''),String(d.startsAt),String(d.venue||''),d.capacity?Number(d.capacity):null,String(d.status||'registration open'),u.id);audit(u,'create','event',Number(r.lastInsertRowid));return send(res,201,{id:Number(r.lastInsertRowid)});
    }
    if(req.method==='PATCH'&&/^\/api\/events\/\d+$/.test(pathname)){
      const u=requireUser(req,res,new Set(['gallery_admin','institution_admin']));if(!u)return;const id=Number(pathname.split('/').at(-1)),d=await body(req),event=db.prepare('SELECT * FROM events WHERE id=?').get(id);if(!event)return fail(res,404,'Event not found.');if(u.role==='institution_admin'&&event.created_by!==u.id)return fail(res,403,'You can only manage events created by your institution.');if(d.status&&!['registration open','fully booked','ongoing','completed','cancelled'].includes(d.status))return fail(res,400,'Invalid event status.');if(d.status)db.prepare('UPDATE events SET status=? WHERE id=?').run(d.status,id);if(d.status==='cancelled'){for(const row of rows('SELECT user_id FROM event_registrations WHERE event_id=?',id))notify(row.user_id,`Event cancelled: ${event.title}`);}audit(u,'update','event',id,d.status||'details');return send(res,200,{ok:true});
    }
    if(req.method==='POST'&&/^\/api\/events\/\d+\/register$/.test(pathname)){
      const u=requireUser(req,res);if(!u)return;const id=Number(pathname.split('/')[3]),event=db.prepare("SELECT * FROM events WHERE id=? AND status='registration open'").get(id);if(!event)return fail(res,404,'Registration is not open.');if(event.capacity&&db.prepare('SELECT COUNT(*) n FROM event_registrations WHERE event_id=?').get(id).n>=event.capacity)return fail(res,409,'This event is fully booked.');try{db.prepare('INSERT INTO event_registrations(event_id,user_id) VALUES(?,?)').run(id,u.id);}catch{return fail(res,409,'You are already registered.');}notify(u.id,`Registration confirmed: ${event.title}`);return send(res,201,{ok:true});
    }
    if(req.method==='DELETE'&&/^\/api\/events\/\d+\/register$/.test(pathname)){
      const u=requireUser(req,res);if(!u)return;const id=Number(pathname.split('/')[3]);db.prepare('DELETE FROM event_registrations WHERE event_id=? AND user_id=?').run(id,u.id);return send(res,200,{ok:true});
    }
    if(req.method==='POST'&&pathname==='/api/collaborations'){
      const u=requireUser(req,res,new Set(['gallery_admin','institution_admin']));if(!u)return;const d=await body(req),iid=Number(d.institutionId),organizerId=u.institution_id||Number(d.organizerInstitutionId);if(!iid||iid===organizerId||!db.prepare("SELECT id FROM institutions WHERE id=? AND status='approved'").get(iid)||!db.prepare("SELECT id FROM institutions WHERE id=? AND status='approved'").get(organizerId))return fail(res,400,'Choose two approved partner institutions.');if(u.role==='institution_admin'&&organizerId!==u.institution_id)return fail(res,403,'Your institution must be the organizer.');const exhibitionId=d.exhibitionId?Number(d.exhibitionId):null;if(exhibitionId&&!db.prepare('SELECT id FROM exhibitions WHERE id=?').get(exhibitionId))return fail(res,400,'Select a valid exhibition.');const r=db.prepare('INSERT INTO collaborations(exhibition_id,institution_id,organizer_institution_id,message,created_by) VALUES(?,?,?,?,?)').run(exhibitionId,iid,organizerId,String(d.message||'').slice(0,3000),u.id);for(const member of rows("SELECT id FROM users WHERE institution_id=? AND role='institution_admin'",iid))notify(member.id,'New exhibition collaboration invitation.');audit(u,'invite','collaboration',Number(r.lastInsertRowid));return send(res,201,{id:Number(r.lastInsertRowid)});
    }
    if(req.method==='PATCH'&&/^\/api\/collaborations\/\d+$/.test(pathname)){
      const u=requireUser(req,res,new Set(['gallery_admin','institution_admin']));if(!u)return;const id=Number(pathname.split('/').at(-1)),d=await body(req);if(!['accepted','declined'].includes(d.status))return fail(res,400,'Choose accepted or declined.');const c=db.prepare('SELECT * FROM collaborations WHERE id=?').get(id);if(!c)return fail(res,404,'Request not found.');if(u.role!=='gallery_admin'&&c.institution_id!==u.institution_id)return fail(res,403,'This request belongs to another institution.');db.prepare('UPDATE collaborations SET status=? WHERE id=?').run(d.status,id);for(const member of rows('SELECT id FROM users WHERE institution_id=? AND role=\'institution_admin\'',c.organizer_institution_id))notify(member.id,`Collaboration invitation ${d.status}.`);audit(u,d.status,'collaboration',id);return send(res,200,{ok:true});
    }
    if(req.method==='GET'&&pathname==='/api/messages'){
      const u=requireUser(req,res);if(!u)return;return send(res,200,{conversations:rows('SELECT c.id,c.subject,c.created_at FROM conversations c JOIN conversation_members m ON m.conversation_id=c.id WHERE m.user_id=? ORDER BY c.created_at DESC',u.id)});
    }
    if(req.method==='GET'&&pathname==='/api/contacts'){
      const u=requireUser(req,res);if(!u)return;let list;
      if(u.role==='gallery_admin')list=rows("SELECT id,full_name AS fullName,email,role,institution_id AS institutionId FROM users WHERE status='active' AND id<>? ORDER BY full_name",u.id);
      else if(u.role==='institution_admin')list=rows("SELECT id,full_name AS fullName,email,role,institution_id AS institutionId FROM users WHERE status='active' AND id<>? AND (role='gallery_admin' OR institution_id=?) ORDER BY full_name",u.id,u.institution_id);
      else list=rows("SELECT id,full_name AS fullName,email,role,institution_id AS institutionId FROM users WHERE status='active' AND role='gallery_admin' ORDER BY full_name");
      return send(res,200,{contacts:list});
    }
    if(req.method==='POST'&&pathname==='/api/messages'){
      const u=requireUser(req,res);if(!u)return;const d=await body(req),text=String(d.body||'').trim();if(text.length<1||text.length>4000)return fail(res,400,'Messages must contain up to 4,000 characters.');let cid=Number(d.conversationId)||0;
      if(!cid){const recipient=db.prepare('SELECT id,role,institution_id FROM users WHERE id=? AND status=?').get(Number(d.recipientId),'active');if(!recipient)return fail(res,404,'Recipient not found.');if(u.role==='artist'&&recipient.role!=='gallery_admin')return fail(res,403,'Artists can message gallery administrators.');if(u.role==='institution_admin'&&recipient.role!=='gallery_admin'&&recipient.institution_id!==u.institution_id)return fail(res,403,'You cannot message outside your institution and gallery team.');const c=db.prepare('INSERT INTO conversations(subject) VALUES(?)').run(String(d.subject||'Conversation').slice(0,160));cid=Number(c.lastInsertRowid);db.prepare('INSERT INTO conversation_members(conversation_id,user_id) VALUES(?,?),(?,?)').run(cid,u.id,cid,recipient.id);}
      if(!db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?').get(cid,u.id))return fail(res,403,'You are not part of this conversation.');const r=db.prepare('INSERT INTO messages(conversation_id,sender_id,body) VALUES(?,?,?)').run(cid,u.id,text);const recipients=rows('SELECT user_id FROM conversation_members WHERE conversation_id=? AND user_id<>?',cid,u.id);for(const x of recipients)notify(x.user_id,`New message from ${u.full_name}`);return send(res,201,{id:Number(r.lastInsertRowid),conversationId:cid});
    }
    if(req.method==='GET'&&/^\/api\/messages\/\d+$/.test(pathname)){
      const u=requireUser(req,res);if(!u)return;const cid=Number(pathname.split('/').at(-1));if(!db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?').get(cid,u.id))return fail(res,403,'You are not part of this conversation.');db.prepare('UPDATE messages SET read_at=CURRENT_TIMESTAMP WHERE conversation_id=? AND sender_id<>? AND read_at IS NULL').run(cid,u.id);return send(res,200,{messages:rows('SELECT m.id,m.sender_id,m.body,m.created_at,u.full_name AS sender FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=? ORDER BY m.created_at',cid)});
    }
    if(req.method==='GET'&&pathname==='/api/reports'){
      const u=requireUser(req,res,new Set(['gallery_admin','institution_admin']));if(!u)return;const from=url.searchParams.get('from')||'0000-01-01',to=url.searchParams.get('to')||'9999-12-31',inst=u.role==='institution_admin'?u.institution_id:null,scope=inst?' AND institution_id='+Number(inst):'';
      const users=inst?db.prepare("SELECT COUNT(*) n FROM users WHERE institution_id=? AND status<>'demo' AND date(created_at) BETWEEN date(?) AND date(?)").get(inst,from,to).n:db.prepare("SELECT COUNT(*) n FROM users WHERE status<>'demo' AND date(created_at) BETWEEN date(?) AND date(?)").get(from,to).n;
      const artists=inst?db.prepare("SELECT COUNT(*) n FROM users WHERE institution_id=? AND role='artist' AND status<>'demo' AND date(created_at) BETWEEN date(?) AND date(?)").get(inst,from,to).n:db.prepare("SELECT COUNT(*) n FROM users WHERE role='artist' AND status<>'demo' AND date(created_at) BETWEEN date(?) AND date(?)").get(from,to).n;
      const submissions=inst?db.prepare('SELECT COUNT(*) n FROM submissions s JOIN artworks a ON a.id=s.artwork_id WHERE a.institution_id=? AND date(s.submitted_at) BETWEEN date(?) AND date(?)').get(inst,from,to).n:db.prepare('SELECT COUNT(*) n FROM submissions WHERE date(submitted_at) BETWEEN date(?) AND date(?)').get(from,to).n;
      const approved=inst?db.prepare("SELECT COUNT(*) n FROM submissions s JOIN artworks a ON a.id=s.artwork_id WHERE a.institution_id=? AND s.status='approved' AND date(s.submitted_at) BETWEEN date(?) AND date(?)").get(inst,from,to).n:db.prepare("SELECT COUNT(*) n FROM submissions WHERE status='approved' AND date(submitted_at) BETWEEN date(?) AND date(?)").get(from,to).n;
      return send(res,200,{from,to,users,artists,institutions:inst?1:db.prepare("SELECT COUNT(*) n FROM institutions WHERE status='approved'").get().n,submissions,approved,events:inst?db.prepare('SELECT COUNT(*) n FROM events WHERE created_by IN (SELECT id FROM users WHERE institution_id=?) AND date(starts_at) BETWEEN date(?) AND date(?)').get(inst,from,to).n:db.prepare('SELECT COUNT(*) n FROM events WHERE date(starts_at) BETWEEN date(?) AND date(?)').get(from,to).n,monthly:inst?rows("SELECT strftime('%Y-%m',s.submitted_at) month,COUNT(*) count FROM submissions s JOIN artworks a ON a.id=s.artwork_id WHERE a.institution_id=? AND date(s.submitted_at) BETWEEN date(?) AND date(?) GROUP BY month ORDER BY month",inst,from,to):rows("SELECT strftime('%Y-%m',submitted_at) month,COUNT(*) count FROM submissions WHERE date(submitted_at) BETWEEN date(?) AND date(?) GROUP BY month ORDER BY month",from,to)});
    }
    if(req.method==='POST'&&pathname==='/api/notifications/read'){
      const u=requireUser(req,res);if(!u)return;db.prepare('UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE user_id=?').run(u.id);return send(res,200,{ok:true});
    }
    if(req.method==='DELETE'&&pathname==='/api/notifications'){
      const u=requireUser(req,res);if(!u)return;db.prepare('DELETE FROM notifications WHERE user_id=?').run(u.id);return send(res,200,{ok:true});
    }
    if(req.method==='GET'&&pathname==='/api/users'){
      const u=requireUser(req,res,new Set(['gallery_admin','institution_admin']));if(!u)return;const list=u.role==='gallery_admin'?rows("SELECT id,email,full_name AS fullName,role,institution_id AS institutionId,status,created_at AS createdAt FROM users WHERE status<>'demo' ORDER BY created_at DESC LIMIT 500"):rows("SELECT id,email,full_name AS fullName,role,institution_id AS institutionId,status,created_at AS createdAt FROM users WHERE institution_id=? AND status<>'demo' ORDER BY created_at DESC LIMIT 500",u.institution_id);return send(res,200,{users:list});
    }
    if(req.method==='PATCH'&&/^\/api\/users\/\d+$/.test(pathname)){
      const u=requireUser(req,res,new Set(['gallery_admin','institution_admin']));if(!u)return;const id=Number(pathname.split('/').at(-1)),d=await body(req),target=statements.userById.get(id);if(!target)return fail(res,404,'User not found.');if(u.role==='institution_admin'&&target.institution_id!==u.institution_id)return fail(res,403,'You can only manage users at your institution.');if(!['active','suspended'].includes(d.status))return fail(res,400,'Choose active or suspended.');if(target.role==='gallery_admin'&&u.role!=='gallery_admin')return fail(res,403,'Only a gallery administrator can manage this account.');if(target.role==='gallery_admin'&&d.status==='suspended'&&statements.activeAdmins.get().n<=1)return fail(res,409,'At least one active gallery administrator must remain.');db.prepare('UPDATE users SET status=? WHERE id=?').run(d.status,id);audit(u,'update','user',id,d.status);return send(res,200,{ok:true});
    }
    if(req.method==='PATCH'&&/^\/api\/institutions\/\d+$/.test(pathname)){
      const u=requireUser(req,res,new Set(['gallery_admin']));if(!u)return;const id=Number(pathname.split('/').at(-1)),d=await body(req);if(!['approved','rejected','pending'].includes(d.status))return fail(res,400,'Invalid institution status.');db.prepare('UPDATE institutions SET status=? WHERE id=?').run(d.status,id);if(d.status==='approved')db.prepare("UPDATE users SET status='active' WHERE institution_id=?").run(id);audit(u,'verify','institution',id,d.status);return send(res,200,{ok:true});
    }
    if(pathname.startsWith('/api/')) return fail(res,404,'API route not found.');
    const file=safeStatic(pathname);if(!file){res.writeHead(403);return res.end('Forbidden');}
    fs.readFile(file,(err,data)=>{
      if(err){res.writeHead(404);return res.end('Not found');}
      const ext=path.extname(file),types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
      res.setHeader('Content-Type',types[ext]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
      if(ext==='.html') { const payload=JSON.stringify(bootstrap(userFor(req))).replace(/</g,'\\u003c');data=Buffer.from(data.toString('utf8').replace('<head>','<head><script>window.__ALU_BOOTSTRAP__='+payload+';</script>')); }
      res.end(data);
    });
  }catch(err){fail(res,err.status||500,err.status?err.message:'The server could not complete this request.');}
});

const port=Number(process.argv[2]||4173);
server.listen(port,'127.0.0.1',()=>console.log(`ALU Gallery listening on http://127.0.0.1:${port}`));
