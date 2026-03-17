const { createClient } = require('@libsql/client');

let client = null;
let dbWrapper = null;

async function initDatabase() {
  // Connect to Turso (production) or local SQLite file (development)
  const url = process.env.TURSO_DATABASE_URL || 'file:local.db';
  const authToken = process.env.TURSO_AUTH_TOKEN;

  client = createClient(authToken ? { url, authToken } : { url });

  // Drop and recreate all tables (reset seed data on each deploy)
  await client.batch([
    { sql: 'DROP TABLE IF EXISTS audit_log' },
    { sql: 'DROP TABLE IF EXISTS tickets' },
    { sql: 'DROP TABLE IF EXISTS api_keys' },
    { sql: 'DROP TABLE IF EXISTS vehicles' },
    { sql: 'DROP TABLE IF EXISTS violation_codes' },
    { sql: 'DROP TABLE IF EXISTS municipalities' },
  ]);

  await client.batch([
    { sql: `CREATE TABLE municipalities (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      county TEXT NOT NULL,
      type TEXT NOT NULL
    )` },
    { sql: `CREATE TABLE violation_codes (
      id INTEGER PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      vtl_section TEXT,
      description TEXT NOT NULL,
      default_fine REAL NOT NULL,
      late_penalty_30 REAL DEFAULT 10,
      late_penalty_75 REAL DEFAULT 20,
      severity TEXT DEFAULT 'STANDARD'
    )` },
    { sql: `CREATE TABLE vehicles (
      id INTEGER PRIMARY KEY,
      plate_number TEXT NOT NULL,
      state TEXT DEFAULT 'NY',
      plate_type TEXT DEFAULT 'PAS',
      normalized_plate TEXT NOT NULL,
      make TEXT,
      model TEXT,
      year INTEGER,
      color TEXT,
      reg_expiration TEXT
    )` },
    { sql: `CREATE TABLE tickets (
      id INTEGER PRIMARY KEY,
      ticket_number TEXT UNIQUE NOT NULL,
      vehicle_id INTEGER NOT NULL,
      municipality_id INTEGER NOT NULL,
      violation_code TEXT NOT NULL,
      violation_desc TEXT NOT NULL,
      issue_date TEXT NOT NULL,
      issue_time TEXT,
      due_date TEXT NOT NULL,
      fine_amount REAL NOT NULL,
      late_fee REAL DEFAULT 0,
      payment_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'UNPAID',
      location TEXT,
      officer_badge TEXT,
      meter_number TEXT,
      judgment_date TEXT,
      dmv_reported INTEGER DEFAULT 0,
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
      FOREIGN KEY (municipality_id) REFERENCES municipalities(id)
    )` },
    { sql: `CREATE TABLE api_keys (
      id INTEGER PRIMARY KEY,
      key_hash TEXT UNIQUE NOT NULL,
      municipality_id INTEGER,
      description TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )` },
    { sql: `CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      api_key_id INTEGER,
      endpoint TEXT,
      plate_queried TEXT,
      ip_address TEXT,
      response_code INTEGER
    )` },
  ]);

  // Indexes
  await client.batch([
    { sql: 'CREATE INDEX idx_normalized_plate ON vehicles(normalized_plate)' },
    { sql: 'CREATE INDEX idx_vehicle_tickets ON tickets(vehicle_id)' },
    { sql: 'CREATE INDEX idx_ticket_status ON tickets(status)' },
    { sql: 'CREATE INDEX idx_ticket_issue_date ON tickets(issue_date)' },
    { sql: 'CREATE INDEX idx_municipality_code ON municipalities(code)' },
  ]);

  await seedData();

  // Build the compatibility wrapper
  dbWrapper = createWrapper(client);

  console.log('Database initialized with sample data');
  return dbWrapper;
}

// ──────────────────────────────────────────────────────────────────────
// Compatibility wrapper: exposes sql.js-style exec/run interface
// backed by Turso's async @libsql/client.
//
// sql.js:  db.exec(sql, params)  → [{columns: [], values: [[]]}]
// Turso:   client.execute({sql, args}) → {columns: [], rows: [Row]}
// ──────────────────────────────────────────────────────────────────────
function createWrapper(client) {
  return {
    async exec(sql, params) {
      const result = await client.execute({
        sql,
        args: params || [],
      });

      if (!result.columns.length) return [];

      const values = result.rows.map(row =>
        result.columns.map((_, i) => row[i] ?? null)
      );

      return [{ columns: result.columns, values }];
    },

    async run(sql, params) {
      await client.execute({
        sql,
        args: params || [],
      });
    },
  };
}

// ──────────────────────────────────────────────────────────────────────
// SEED DATA
// ──────────────────────────────────────────────────────────────────────
async function seedData() {
  // VIOLATION CODES
  const violations = [
    ['PKV-01', 'VTL 1202(b)',     'Expired Meter',                         50,  10, 25, 'STANDARD'],
    ['PKV-02', 'VTL 1202(a)(2)',  'No Parking Zone',                       75,  10, 25, 'STANDARD'],
    ['PKV-03', 'VTL 1203-b',     'Handicapped Zone Violation',           150,  30, 50, 'SEVERE'],
    ['PKV-04', 'TC 3-3(B)',      'Overtime Parking - Time Exceeded',      50,  10, 25, 'STANDARD'],
    ['PKV-05', 'VTL 1202(b)',    'Within 15 Feet of Fire Hydrant',       115,  20, 40, 'SEVERE'],
    ['PKV-06', 'TC 4-1(A)(2)',   'Fire Zone Violation',                  100,  20, 40, 'SEVERE'],
    ['PKV-07', 'VTL 1202(a)(1)(a)', 'Double Parking',                    75,  10, 25, 'STANDARD'],
    ['PKV-08', 'TC 3-11(B)',     'Snow Emergency - Residential',          75,  10, 25, 'STANDARD'],
    ['PKV-09', 'TC 3-11(C)',     'Snow Emergency - Business District',    75,  10, 25, 'STANDARD'],
    ['PKV-10', 'TC 3-3(C)',      'No Standing Zone',                      75,  10, 25, 'STANDARD'],
    ['PKV-11', 'VTL 1202(a)(1)(b)', 'Parking on Sidewalk',               75,  10, 25, 'STANDARD'],
    ['PKV-12', 'VTL 1202(a)(1)(d)', 'Parking on Crosswalk',             115,  20, 40, 'SEVERE'],
    ['PKV-13', 'VTL 1202(a)(2)(a)', 'Blocking Driveway',                 75,  10, 25, 'STANDARD'],
    ['PKV-14', 'VTL 1202(a)(2)(c)', 'Within 30 Feet of Stop Sign',       50,  10, 25, 'STANDARD'],
    ['PKV-15', 'VTL 1202(a)(2)(b)', 'Within 20 Feet of Crosswalk',       50,  10, 25, 'STANDARD'],
    ['PKV-16', 'TC 5-2',         'Overnight Parking - Commercial Vehicle', 250, 25, 50, 'SEVERE'],
    ['PKV-17', 'TC 4-2(C)',      'Resident Permit Parking Only',          50,  10, 25, 'STANDARD'],
    ['PKV-18', 'VTL 1202(a)(1)(c)', 'Parking in Intersection',           75,  10, 25, 'STANDARD'],
    ['PKV-19', 'TC 3-3(E)',      'Bus Stop Violation',                    75,  10, 25, 'STANDARD'],
    ['PKV-20', 'VTL 1202(a)(2)(e)', 'Blocking Pedestrian Ramp',         165,  30, 50, 'SEVERE'],
    ['PKV-21', 'Local',          'Alternate Side - Street Cleaning',      65,  10, 25, 'STANDARD'],
    ['PKV-22', 'TC 4-2(B)',      'No Parking 3AM-6AM',                    50,  10, 25, 'STANDARD'],
    ['PKV-23', 'VTL 1202(a)(3)', 'Within 50 Feet of Railroad Crossing',  75,  10, 25, 'STANDARD'],
    ['PKV-24', 'Local',          'Expired Registration Displayed',        65,  10, 25, 'STANDARD'],
    ['PKV-25', 'Local',          'Expired Inspection Sticker',            65,  10, 25, 'STANDARD'],
  ];

  await client.batch(
    violations.map(([code, vtl, desc, fine, late30, late75, severity]) => ({
      sql: 'INSERT INTO violation_codes VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)',
      args: [code, vtl, desc, fine, late30, late75, severity],
    }))
  );

  // MUNICIPALITIES
  const municipalities = [
    [1,'City of Long Beach','LBCH','Nassau','City'],[2,'City of Glen Cove','GLCV','Nassau','City'],
    [3,'Town of Hempstead','HEMP','Nassau','Town'],[4,'Town of North Hempstead','NHMP','Nassau','Town'],[5,'Town of Oyster Bay','OYST','Nassau','Town'],
    [6,'Village of Hempstead','VHMP','Nassau','Village'],[7,'Village of Freeport','FREE','Nassau','Village'],[8,'Village of Rockville Centre','RVCT','Nassau','Village'],
    [9,'Village of Garden City','GRCT','Nassau','Village'],[10,'Village of Lynbrook','LYNK','Nassau','Village'],[11,'Village of Valley Stream','VLST','Nassau','Village'],
    [12,'Village of Mineola','MNLA','Nassau','Village'],[13,'Village of Floral Park','FLPK','Nassau','Village'],[14,'Village of Cedarhurst','CDHT','Nassau','Village'],
    [15,'Village of Lawrence','LWRN','Nassau','Village'],[16,'Village of Malverne','MLVN','Nassau','Village'],[17,'Village of East Rockaway','ERKW','Nassau','Village'],
    [18,'Village of Island Park','ISPK','Nassau','Village'],[19,'Village of Atlantic Beach','ATBH','Nassau','Village'],[20,'Village of South Floral Park','SFPK','Nassau','Village'],
    [21,'Village of Stewart Manor','STMN','Nassau','Village'],[22,'Village of Bellerose','BLRS','Nassau','Village'],[23,'Village of New Hyde Park','NHDP','Nassau','Village'],
    [24,'Village of Great Neck','GTNK','Nassau','Village'],[25,'Village of Great Neck Plaza','GNPL','Nassau','Village'],[26,'Village of Great Neck Estates','GNES','Nassau','Village'],
    [27,'Village of Kings Point','KGPT','Nassau','Village'],[28,'Village of Port Washington North','PWSN','Nassau','Village'],[29,'Village of Roslyn','RSLN','Nassau','Village'],
    [30,'Village of Westbury','WSTB','Nassau','Village'],[31,'Village of Williston Park','WLPK','Nassau','Village'],[32,'Village of Manorhaven','MNHV','Nassau','Village'],
    [33,'Village of Sands Point','SNPT','Nassau','Village'],[34,'Village of Plandome','PLND','Nassau','Village'],[35,'Village of Thomaston','THMS','Nassau','Village'],
    [36,'Village of East Hills','EHLS','Nassau','Village'],[37,'Village of Flower Hill','FWHL','Nassau','Village'],[38,'Village of Kensington','KNST','Nassau','Village'],
    [39,'Village of Lake Success','LKSC','Nassau','Village'],[40,'Village of Munsey Park','MNPK','Nassau','Village'],[41,'Village of North Hills','NHLS','Nassau','Village'],
    [42,'Village of Russell Gardens','RSGD','Nassau','Village'],[43,'Village of Saddle Rock','SDRK','Nassau','Village'],
    [44,'Village of Farmingdale','FMDL','Nassau','Village'],[45,'Village of Massapequa Park','MSPK','Nassau','Village'],[46,'Village of Sea Cliff','SCFL','Nassau','Village'],
    [47,'Village of Bayville','BYVL','Nassau','Village'],[48,'Village of Brookville','BKVL','Nassau','Village'],[49,'Village of Old Brookville','OLBK','Nassau','Village'],
    [50,'Village of Upper Brookville','UPBK','Nassau','Village'],[51,'Village of Old Westbury','OLWB','Nassau','Village'],[52,'Village of Oyster Bay Cove','OBCV','Nassau','Village'],
    [53,'Village of Mill Neck','MLNK','Nassau','Village'],[54,'Village of Laurel Hollow','LRHW','Nassau','Village'],[55,'Village of Centre Island','CTIS','Nassau','Village'],
    [56,'Village of Cove Neck','CVNK','Nassau','Village'],[57,'Village of Muttontown','MTTN','Nassau','Village'],[58,'Village of Lattingtown','LTTN','Nassau','Village'],
    [59,'Village of Matinecock','MTNK','Nassau','Village'],
    [60,'Town of Babylon','BABY','Suffolk','Town'],[61,'Town of Brookhaven','BKHV','Suffolk','Town'],[62,'Town of East Hampton','EHMP','Suffolk','Town'],
    [63,'Town of Huntington','HUNT','Suffolk','Town'],[64,'Town of Islip','ISLP','Suffolk','Town'],[65,'Town of Riverhead','RVHD','Suffolk','Town'],
    [66,'Town of Shelter Island','SHIS','Suffolk','Town'],[67,'Town of Smithtown','SMTH','Suffolk','Town'],[68,'Town of Southampton','SHMP','Suffolk','Town'],
    [69,'Town of Southold','STHD','Suffolk','Town'],
    [70,'Village of Amityville','AMTV','Suffolk','Village'],[71,'Village of Babylon','VBAB','Suffolk','Village'],[72,'Village of Lindenhurst','LNDT','Suffolk','Village'],
    [73,'Village of Patchogue','PTCH','Suffolk','Village'],[74,'Village of Port Jefferson','PTJF','Suffolk','Village'],[75,'Village of Northport','NRPT','Suffolk','Village'],
    [76,'Village of Huntington Bay','HTBY','Suffolk','Village'],[77,'Village of Brightwaters','BRTW','Suffolk','Village'],[78,'Village of Ocean Beach','OCBH','Suffolk','Village'],
    [79,'Village of Saltaire','SLTR','Suffolk','Village'],[80,'Village of East Hampton','VEHM','Suffolk','Village'],[81,'Village of Sag Harbor','SGHB','Suffolk','Village'],
    [82,'Village of Southampton','VSHM','Suffolk','Village'],[83,'Village of Westhampton Beach','WHBH','Suffolk','Village'],[84,'Village of Greenport','GRPT','Suffolk','Village'],
    [85,'Village of Bellport','BLPT','Suffolk','Village'],[86,'Village of Lake Grove','LKGV','Suffolk','Village'],[87,'Village of Belle Terre','BLTR','Suffolk','Village'],
    [88,'Village of Quogue','QUOG','Suffolk','Village'],[89,'Village of Islandia','ISLA','Suffolk','Village'],[90,'Village of Head of the Harbor','HDHB','Suffolk','Village'],
  ];

  await client.batch(
    municipalities.map(([id, name, code, county, type]) => ({
      sql: 'INSERT INTO municipalities VALUES (?, ?, ?, ?, ?)',
      args: [id, name, code, county, type],
    }))
  );

  // VEHICLES
  const vehicles = [
    [1,'KAB-3291','NY','PAS','KAB3291','Toyota','Camry',2021,'White','2026-08-15'],
    [2,'KDF-7823','NY','PAS','KDF7823','Honda','Civic',2020,'Silver','2026-03-22'],
    [3,'KHN-4456','NY','PAS','KHN4456','Ford','F-150',2022,'Black','2026-11-01'],
    [4,'LAC-1190','NY','PAS','LAC1190','Nissan','Altima',2019,'Blue','2025-12-30'],
    [5,'LBE-6634','NY','PAS','LBE6634','Chevrolet','Malibu',2023,'Gray','2026-07-18'],
    [6,'LFG-2218','NY','PAS','LFG2218','Hyundai','Elantra',2021,'Red','2026-05-09'],
    [7,'LKR-9901','NY','PAS','LKR9901','BMW','330i',2022,'Black','2026-09-25'],
    [8,'MAB-1147','NY','PAS','MAB1147','Kia','Forte',2020,'White','2026-01-14'],
    [9,'MCE-5532','NY','PAS','MCE5532','Subaru','Outback',2023,'Green','2027-02-28'],
    [10,'MDF-8876','NY','PAS','MDF8876','Lexus','RX350',2024,'Pearl','2027-04-15'],
    [11,'AT-63291','NY','COM','AT63291','Ford','Transit',2021,'White','2026-06-30'],
    [12,'BL-17845','NY','COM','BL17845','Chevrolet','Express',2019,'White','2025-11-15'],
    [13,'U38-KBN','NJ','PAS','U38KBN','Toyota','RAV4',2022,'Blue','2026-10-01'],
    [14,'U52-DFM','NJ','PAS','U52DFM','Honda','Accord',2021,'Black','2026-04-18'],
    [15,'T94-PLG','NJ','PAS','T94PLG','Mercedes','C300',2023,'Silver','2027-01-22'],
    [16,'BK-38291','CT','PAS','BK38291','Volkswagen','Jetta',2020,'Gray','2026-08-31'],
    [17,'CN-41058','CT','PAS','CN41058','Audi','A4',2022,'White','2026-12-15'],
    [18,'LMN-4521','PA','PAS','LMN4521','Dodge','Charger',2021,'Red','2026-07-01'],
    [19,'HBL-6639','NY','PAS','HBL6639','Toyota','Corolla',2017,'Silver','2026-02-28'],
    [20,'GCR-4412','NY','PAS','GCR4412','Honda','CR-V',2018,'Blue','2026-06-14'],
    [21,'KSS-7744','NY','PAS','KSS7744','Infiniti','Q50',2020,'Black','2025-09-30'],
    [22,'DEMO-123','NY','PAS','DEMO123','Demo','Vehicle',2024,'Blue','2027-12-31'],
  ];

  await client.batch(
    vehicles.map(([id, plate, state, type, normalized, make, model, year, color, regExp]) => ({
      sql: 'INSERT INTO vehicles VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [id, plate, state, type, normalized, make, model, year, color, regExp],
    }))
  );

  // TICKETS
  const tickets = [
    [1,'VHMP-2025-004821',1,6,'PKV-01','Expired Meter','2025-06-12','09:42','2025-07-12',50,25,0,'UNPAID','185 Main St, Hempstead','E-1147','M-0042',null,0],
    [2,'VHMP-2025-005134',1,6,'PKV-02','No Parking Zone','2025-07-03','14:18','2025-08-03',75,25,0,'UNPAID','220 Fulton Ave, Hempstead','E-1147',null,null,0],
    [3,'VHMP-2025-006290',1,6,'PKV-05','Within 15 Feet of Fire Hydrant','2025-08-21','11:05','2025-09-21',115,40,0,'UNPAID','47 Greenwich St, Hempstead','E-2034',null,null,0],
    [4,'VHMP-2025-007401',1,6,'PKV-07','Double Parking','2025-10-15','16:30','2025-11-15',75,10,0,'UNPAID','301 Front St, Hempstead','E-1147',null,null,0],
    [5,'FREE-2025-001876',2,7,'PKV-21','Alternate Side - Street Cleaning','2025-03-10','08:15','2025-04-10',65,0,65,'PAID','55 N Main St, Freeport','E-3021',null,null,0],
    [6,'FREE-2025-002541',2,7,'PKV-01','Expired Meter','2025-05-22','13:50','2025-06-22',50,25,0,'JUDGMENT','112 W Merrick Rd, Freeport','E-3021','M-0118','2025-08-22',1],
    [7,'RVCT-2025-000934',3,8,'PKV-04','Overtime Parking - Time Exceeded','2025-02-14','10:22','2025-03-14',50,0,50,'PAID','245 Sunrise Hwy, Rockville Centre','E-4102','M-0203',null,0],
    [8,'RVCT-2025-001287',3,8,'PKV-14','Within 30 Feet of Stop Sign','2025-04-08','15:40','2025-05-08',50,0,50,'PAID','10 Village Ave, Rockville Centre','E-4102',null,null,0],
    [9,'GRCT-2025-002103',4,9,'PKV-01','Expired Meter','2025-01-18','09:30','2025-02-18',50,25,0,'JUDGMENT','843 Franklin Ave, Garden City','E-5200','M-0087','2025-04-18',1],
    [10,'GRCT-2025-003456',4,9,'PKV-02','No Parking Zone','2025-03-25','11:15','2025-04-25',75,25,0,'JUDGMENT','100 7th St, Garden City','E-5200',null,'2025-06-25',1],
    [11,'GRCT-2025-004012',4,9,'PKV-13','Blocking Driveway','2025-05-09','07:45','2025-06-09',75,25,0,'UNPAID','212 Stewart Ave, Garden City','E-5201',null,null,0],
    [12,'GRCT-2025-005578',4,9,'PKV-05','Within 15 Feet of Fire Hydrant','2025-07-14','14:00','2025-08-14',115,40,0,'UNPAID','500 Hilton Ave, Garden City','E-5200',null,null,0],
    [13,'GRCT-2025-006890',4,9,'PKV-03','Handicapped Zone Violation','2025-09-02','12:30','2025-10-02',150,50,0,'UNPAID','15 Cathedral Ave, Garden City','E-5201',null,null,0],
    [14,'LYNK-2025-001100',5,10,'PKV-17','Resident Permit Parking Only','2025-06-28','19:20','2025-07-28',50,0,0,'DISPUTED','88 Atlantic Ave, Lynbrook','E-6010',null,null,0],
    [15,'VLST-2025-000445',6,11,'PKV-22','No Parking 3AM-6AM','2025-04-05','03:30','2025-05-05',50,25,0,'UNPAID','33 Rockaway Ave, Valley Stream','E-7100',null,null,0],
    [16,'VLST-2025-001203',6,11,'PKV-22','No Parking 3AM-6AM','2025-06-12','04:15','2025-07-12',50,25,0,'UNPAID','33 Rockaway Ave, Valley Stream','E-7100',null,null,0],
    [17,'VLST-2025-001887',6,11,'PKV-22','No Parking 3AM-6AM','2025-08-19','03:45','2025-09-19',50,10,0,'UNPAID','33 Rockaway Ave, Valley Stream','E-7100',null,null,0],
    [18,'GTNK-2025-000312',7,24,'PKV-06','Fire Zone Violation','2025-05-30','20:10','2025-06-30',100,0,100,'PAID','1 Middle Neck Rd, Great Neck','E-8001',null,null,0],
    [19,'MNLA-2026-000089',8,12,'PKV-08','Snow Emergency - Residential','2026-01-06','06:00','2026-02-06',75,10,0,'UNPAID','14 Elm Place, Mineola','E-9055',null,null,0],
    [20,'MNLA-2026-000112',8,12,'PKV-09','Snow Emergency - Business District','2026-01-06','06:15','2026-02-06',75,10,0,'UNPAID','200 Old Country Rd, Mineola','E-9055',null,null,0],
    [21,'HUNT-2025-003290',10,63,'PKV-04','Overtime Parking - Time Exceeded','2025-09-14','11:45','2025-10-14',50,10,25,'PARTIAL','230 Main St, Huntington','E-1200','M-0301',null,0],
    [22,'BABY-2025-001678',11,60,'PKV-16','Overnight Parking - Commercial Vehicle','2025-04-20','02:30','2025-05-20',250,50,0,'JUDGMENT','88 Deer Park Ave, Babylon','E-1301',null,'2025-07-20',1],
    [23,'BABY-2025-002901',11,60,'PKV-16','Overnight Parking - Commercial Vehicle','2025-06-15','03:00','2025-07-15',250,25,0,'UNPAID','88 Deer Park Ave, Babylon','E-1301',null,null,0],
    [24,'SMTH-2025-000567',12,67,'PKV-16','Overnight Parking - Commercial Vehicle','2025-08-03','01:15','2025-09-03',250,25,0,'UNPAID','45 Maple Ave, Smithtown','E-1402',null,null,0],
    [25,'LBCH-2025-002145',13,1,'PKV-01','Expired Meter','2025-07-04','12:00','2025-08-04',50,25,0,'UNPAID','101 E Park Ave, Long Beach','E-2001','M-0501',null,0],
    [26,'LBCH-2025-002890',13,1,'PKV-12','Parking on Crosswalk','2025-08-15','16:45','2025-09-15',115,20,0,'UNPAID','National Blvd & W Beech St, Long Beach','E-2003',null,null,0],
    [27,'GLCV-2025-000789',14,2,'PKV-10','No Standing Zone','2025-06-20','08:30','2025-07-20',75,0,75,'PAID','3 Village Square, Glen Cove','E-2101',null,null,0],
    [28,'GTNK-2025-001004',15,24,'PKV-02','No Parking Zone','2025-09-10','10:00','2025-10-10',75,0,0,'DISMISSED','25 S Middle Neck Rd, Great Neck','E-8001',null,null,0],
    [29,'PTCH-2025-000234',16,73,'PKV-01','Expired Meter','2025-05-10','14:20','2025-06-10',50,25,0,'UNPAID','15 W Main St, Patchogue','E-3100','M-0088',null,0],
    [30,'SGHB-2025-000156',17,81,'PKV-05','Within 15 Feet of Fire Hydrant','2025-07-22','18:30','2025-08-22',115,0,115,'PAID','Main St & Madison St, Sag Harbor','E-3200',null,null,0],
    [31,'PTJF-2025-000098',18,74,'PKV-04','Overtime Parking - Time Exceeded','2025-06-01','13:10','2025-07-01',50,25,0,'UNPAID','101 E Broadway, Port Jefferson','E-3301','M-0020',null,0],
    [32,'OYST-2025-003412',19,5,'PKV-02','No Parking Zone','2024-11-05','10:30','2024-12-05',75,25,0,'JUDGMENT','55 South St, Oyster Bay','E-4001',null,'2025-02-05',1],
    [33,'OYST-2025-003890',19,5,'PKV-01','Expired Meter','2025-01-14','09:00','2025-02-14',50,25,0,'JUDGMENT','100 Audrey Ave, Oyster Bay','E-4001','M-0150','2025-04-14',1],
    [34,'OYST-2025-004123',19,5,'PKV-11','Parking on Sidewalk','2025-03-20','15:45','2025-04-20',75,25,0,'JUDGMENT','12 E Main St, Oyster Bay','E-4002',null,'2025-06-20',1],
    [35,'NHMP-2025-001567',20,4,'PKV-15','Within 20 Feet of Crosswalk','2025-05-18','11:20','2025-06-18',50,25,0,'UNPAID','1 North Station Plaza, Great Neck','E-5001',null,null,0],
    [36,'NHMP-2025-002001',20,4,'PKV-21','Alternate Side - Street Cleaning','2025-07-08','07:30','2025-08-08',65,0,65,'PAID','Northern Blvd & Lakeville Rd, Great Neck','E-5001',null,null,0],
    [37,'VHMP-2025-008001',21,6,'PKV-01','Expired Meter','2025-02-10','10:00','2025-03-10',50,25,0,'JUDGMENT','100 N Franklin St, Hempstead','E-1147','M-0042','2025-05-10',1],
    [38,'VHMP-2025-008402',21,6,'PKV-07','Double Parking','2025-03-18','13:45','2025-04-18',75,25,0,'JUDGMENT','200 Fulton Ave, Hempstead','E-2034',null,'2025-06-18',1],
    [39,'VHMP-2025-008990',21,6,'PKV-05','Within 15 Feet of Fire Hydrant','2025-04-22','09:15','2025-05-22',115,40,0,'JUDGMENT','55 Main St, Hempstead','E-1147',null,'2025-07-22',1],
    [40,'VHMP-2025-009345',21,6,'PKV-03','Handicapped Zone Violation','2025-06-05','16:00','2025-07-05',150,50,0,'UNPAID','310 Fulton Ave, Hempstead','E-2034',null,null,0],
    [41,'FREE-2025-004521',21,7,'PKV-02','No Parking Zone','2025-07-30','11:30','2025-08-30',75,25,0,'UNPAID','45 W Merrick Rd, Freeport','E-3021',null,null,0],
    [42,'FREE-2025-005012',21,7,'PKV-13','Blocking Driveway','2025-09-12','07:00','2025-10-12',75,25,0,'UNPAID','220 S Main St, Freeport','E-3022',null,null,0],
    [43,'RVCT-2025-003456',21,8,'PKV-06','Fire Zone Violation','2025-11-01','20:45','2025-12-01',100,10,0,'UNPAID','400 Sunrise Hwy, Rockville Centre','E-4102',null,null,0],
    [44,'ISLP-2025-009001',22,64,'PKV-01','Expired Meter','2025-03-15','10:30','2025-04-15',50,25,0,'UNPAID','500 Main St, Islip','E-6789','M-0400',null,0],
    [45,'HUNT-2025-009002',22,63,'PKV-05','Within 15 Feet of Fire Hydrant','2025-05-20','14:15','2025-06-20',115,40,0,'UNPAID','600 New York Ave, Huntington','E-7890',null,null,0],
    [46,'BKHV-2025-009003',22,61,'PKV-02','No Parking Zone','2025-08-10','09:45','2025-09-10',75,25,0,'UNPAID','700 Middle Country Rd, Brookhaven','E-8901',null,null,0],
    [47,'EHMP-2025-009004',22,62,'PKV-04','Overtime Parking - Time Exceeded','2025-10-02','15:00','2025-11-02',50,10,0,'UNPAID','30 Main St, East Hampton','E-9012','M-0055',null,0],
    [48,'OCBH-2025-000012',13,78,'PKV-17','Resident Permit Parking Only','2025-07-12','11:00','2025-08-12',50,10,0,'UNPAID','Bay Walk, Ocean Beach','E-OB01',null,null,0],
    [49,'WHBH-2025-000045',18,83,'PKV-02','No Parking Zone','2025-08-02','17:30','2025-09-02',75,10,0,'UNPAID','90 Main St, Westhampton Beach','E-WH01',null,null,0],
    [50,'VSHM-2025-000321',15,82,'PKV-04','Overtime Parking - Time Exceeded','2025-07-25','12:15','2025-08-25',50,0,50,'PAID','40 Jobs Ln, Southampton','E-SH01','M-0030',null,0],
    [51,'SGHB-2025-000890',14,81,'PKV-01','Expired Meter','2025-08-08','13:00','2025-09-08',50,10,0,'UNPAID','55 Main St, Sag Harbor','E-3200','M-0012',null,0],
    [52,'VEHM-2025-000456',17,80,'PKV-06','Fire Zone Violation','2025-07-18','21:00','2025-08-18',100,20,0,'UNPAID','94 Montauk Hwy, East Hampton','E-EH01',null,null,0],
    [53,'WSTB-2025-000234',4,30,'PKV-20','Blocking Pedestrian Ramp','2025-10-28','08:45','2025-11-28',165,0,0,'UNPAID','100 Post Ave, Westbury','E-WB01',null,null,0],
    [54,'FMDL-2025-001234',19,44,'PKV-24','Expired Registration Displayed','2025-09-05','10:00','2025-10-05',65,10,0,'UNPAID','370 Conklin St, Farmingdale','E-FM01',null,null,0],
    [55,'FMDL-2025-001235',19,44,'PKV-25','Expired Inspection Sticker','2025-09-05','10:00','2025-10-05',65,10,0,'UNPAID','370 Conklin St, Farmingdale','E-FM01',null,null,0],
    [56,'LNDT-2025-000678',12,72,'PKV-23','Within 50 Feet of Railroad Crossing','2025-07-10','15:30','2025-08-10',75,10,0,'UNPAID','S Wellwood Ave & LIRR, Lindenhurst','E-LN01',null,null,0],
    [57,'MNLA-2025-002890',8,12,'PKV-19','Bus Stop Violation','2025-10-20','08:00','2025-11-20',75,0,0,'UNPAID','Jericho Tpke & Mineola Blvd, Mineola','E-9055',null,null,0],
    [58,'NRPT-2025-000123',16,75,'PKV-18','Parking in Intersection','2025-06-14','17:00','2025-07-14',75,25,0,'UNPAID','Main St & Woodbine Ave, Northport','E-NP01',null,null,0],
  ];

  // Batch in chunks of 20 (Turso batch limit considerations)
  for (let i = 0; i < tickets.length; i += 20) {
    const chunk = tickets.slice(i, i + 20);
    await client.batch(
      chunk.map(args => ({
        sql: 'INSERT INTO tickets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        args,
      }))
    );
  }

  // API KEYS
  const apiKeys = [
    [1,'fps-demo-key-2024',null,'Demo API Key',1],
    [2,'hemp-enforcement-001',6,'Village of Hempstead - Enforcement',1],
    [3,'oyst-enforcement-001',5,'Town of Oyster Bay - Enforcement',1],
    [4,'grct-enforcement-001',9,'Village of Garden City - Enforcement',1],
    [5,'lbch-enforcement-001',1,'City of Long Beach - Enforcement',1],
    [6,'hunt-enforcement-001',63,'Town of Huntington - Enforcement',1],
    [7,'free-enforcement-001',7,'Village of Freeport - Enforcement',1],
    [8,'handheld-partner-001',null,'Handheld Device Partner - Full Access',1],
  ];

  await client.batch(
    apiKeys.map(([id, key, mun, desc, active]) => ({
      sql: `INSERT INTO api_keys VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      args: [id, key, mun, desc, active],
    }))
  );

  console.log(`  Seeded ${tickets.length} tickets across 90 municipalities`);
}

function getDb() {
  return dbWrapper;
}

function normalizePlate(plate) {
  return plate.replace(/[\s\-]/g, '').toUpperCase();
}

module.exports = { initDatabase, getDb, normalizePlate };
