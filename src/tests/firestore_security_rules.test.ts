/**
 * @file firestore_security_rules.test.ts
 * @description Comprehensive Automated Security Test Suite for Cloud Firestore Rules.
 * 
 * Tests executed against the local Firebase Firestore Emulator.
 * Validates:
 * 1. Unauthenticated access boundaries (default deny)
 * 2. Cross-student data isolation (Student A vs Student B)
 * 3. Privilege escalation prevention on create and update
 * 4. Role immutability for non-admins (including omitted role edge-case)
 * 5. Admin verification defense: unverified email denied, verified email allowed
 * 6. Admin custom claim ({ admin: true }) verification
 * 7. Certificate lifecycle: public single-get allowed, listing restricted, update blocked, delete admin-only
 * 8. Subcollection foreign-key matching and isolation (/profiles, /recitations)
 * 9. Schema validation and forbidden extra field rejections
 * 10. Smoke-test endpoint /test/connection read-only enforcement
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ID = 'zeta-torch-nz37z';
const EMULATOR_HOST = '127.0.0.1';
const EMULATOR_PORT = 8085;

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  const rules = fs.readFileSync(rulesPath, 'utf8');

  // Point explicitly to the running emulator
  process.env.FIRESTORE_EMULATOR_HOST = `${EMULATOR_HOST}:${EMULATOR_PORT}`;

  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      host: EMULATOR_HOST,
      port: EMULATOR_PORT,
    },
  });
});

afterAll(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

beforeEach(async () => {
  if (testEnv) {
    await testEnv.clearFirestore();
  }
});

describe('Cloud Firestore Security Rules - Automated Security Verification', () => {
  // Context Factories
  const getUnauthDb = () => testEnv.unauthenticatedContext().firestore();
  
  const getUserDb = (uid: string, email: string = `${uid}@student.quran`) =>
    testEnv.authenticatedContext(uid, { email, email_verified: true }).firestore();

  const getUnverifiedAdminDb = () =>
    testEnv.authenticatedContext('fake_admin_uid', {
      email: 'ahmed.sheta89@gmail.com',
      email_verified: false,
    }).firestore();

  const getVerifiedAdminDb = () =>
    testEnv.authenticatedContext('real_admin_uid', {
      email: 'ahmed.sheta89@gmail.com',
      email_verified: true,
    }).firestore();

  const getClaimAdminDb = () =>
    testEnv.authenticatedContext('claim_admin_uid', {
      email: 'custom_admin@quran.org',
      email_verified: true,
      admin: true,
    }).firestore();

  const getNonAdminClaimDb = () =>
    testEnv.authenticatedContext('regular_user_uid', {
      email: 'regular@quran.org',
      email_verified: true,
      admin: false,
    }).firestore();

  // ===============================================================
  // 1. Unauthenticated Access & Default Deny
  // ===============================================================
  describe('1. Unauthenticated Access Controls', () => {
    it('DENIES unauthenticated user from reading user profiles', async () => {
      const db = getUnauthDb();
      await assertFails(getDoc(doc(db, 'users', 'student_1')));
    });

    it('DENIES unauthenticated user from listing users collection', async () => {
      const db = getUnauthDb();
      await assertFails(getDocs(collection(db, 'users')));
    });

    it('DENIES unauthenticated user from creating user documents', async () => {
      const db = getUnauthDb();
      await assertFails(
        setDoc(doc(db, 'users', 'anon'), {
          uid: 'anon',
          email: 'anon@test.com',
          role: 'STUDENT',
        })
      );
    });

    it('DENIES unauthenticated user from reading arbitrary collections', async () => {
      const db = getUnauthDb();
      await assertFails(getDoc(doc(db, 'secret_collection', 'doc1')));
    });
  });

  // ===============================================================
  // 2. Cross-Student Data Isolation
  // ===============================================================
  describe('2. Cross-Student Isolation & Ownership', () => {
    it('ALLOWS Student A to create and read their own user profile', async () => {
      const db = getUserDb('student_a');
      const profile = {
        uid: 'student_a',
        email: 'student_a@student.quran',
        displayName: 'طالب أ',
        role: 'STUDENT',
        createdAt: new Date().toISOString(),
      };
      await assertSucceeds(setDoc(doc(db, 'users', 'student_a'), profile));
      await assertSucceeds(getDoc(doc(db, 'users', 'student_a')));
    });

    it('DENIES Student B from reading Student A profile', async () => {
      // Seed Student A
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', 'student_a'), {
          uid: 'student_a',
          email: 'student_a@student.quran',
          displayName: 'طالب أ',
          role: 'STUDENT',
        });
      });

      const dbB = getUserDb('student_b');
      await assertFails(getDoc(doc(dbB, 'users', 'student_a')));
    });

    it('DENIES Student B from modifying Student A profile', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', 'student_a'), {
          uid: 'student_a',
          email: 'student_a@student.quran',
          displayName: 'طالب أ',
          role: 'STUDENT',
        });
      });

      const dbB = getUserDb('student_b');
      await assertFails(
        updateDoc(doc(dbB, 'users', 'student_a'), {
          displayName: 'تغيير غير مصرح به',
        })
      );
    });

    it('DENIES Student B from deleting Student A user account', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', 'student_a'), {
          uid: 'student_a',
          email: 'student_a@student.quran',
          role: 'STUDENT',
        });
      });

      const dbB = getUserDb('student_b');
      await assertFails(deleteDoc(doc(dbB, 'users', 'student_a')));
    });

    it('DENIES regular student from listing all users', async () => {
      const db = getUserDb('student_a');
      await assertFails(getDocs(collection(db, 'users')));
    });
  });

  // ===============================================================
  // 3. Privilege Escalation Prevention on Create
  // ===============================================================
  describe('3. Role Escalation Prevention on Create', () => {
    it('DENIES a regular student from creating themselves with role ADMIN', async () => {
      const db = getUserDb('attacker');
      const maliciousProfile = {
        uid: 'attacker',
        email: 'attacker@quran.org',
        role: 'ADMIN',
      };
      await assertFails(setDoc(doc(db, 'users', 'attacker'), maliciousProfile));
    });

    it('ALLOWS a regular student to create themselves with role STUDENT', async () => {
      const db = getUserDb('legit_student');
      const legitProfile = {
        uid: 'legit_student',
        email: 'legit@quran.org',
        role: 'STUDENT',
      };
      await assertSucceeds(setDoc(doc(db, 'users', 'legit_student'), legitProfile));
    });

    it('ALLOWS a regular student to create themselves without explicit role', async () => {
      const db = getUserDb('norole_student');
      const noRoleProfile = {
        uid: 'norole_student',
        email: 'norole@quran.org',
      };
      await assertSucceeds(setDoc(doc(db, 'users', 'norole_student'), noRoleProfile));
    });
  });

  // ===============================================================
  // 4. Role Escalation Prevention on Update (including omitted role edge case)
  // ===============================================================
  describe('4. Role Escalation Prevention on Update', () => {
    it('DENIES student from updating profile to role ADMIN when role was initially omitted', async () => {
      // Seed profile without role
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', 'omitted_student'), {
          uid: 'omitted_student',
          email: 'omitted@quran.org',
        });
      });

      const db = getUserDb('omitted_student');
      // Attempt to inject role: 'ADMIN'
      await assertFails(
        updateDoc(doc(db, 'users', 'omitted_student'), {
          role: 'ADMIN',
        })
      );
    });

    it('DENIES student from changing role from STUDENT to ADMIN', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', 'student_x'), {
          uid: 'student_x',
          email: 'x@quran.org',
          role: 'STUDENT',
        });
      });

      const db = getUserDb('student_x');
      await assertFails(
        updateDoc(doc(db, 'users', 'student_x'), {
          role: 'ADMIN',
        })
      );
    });

    it('DENIES student from changing role from STUDENT to TEACHER', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', 'student_x'), {
          uid: 'student_x',
          email: 'x@quran.org',
          role: 'STUDENT',
        });
      });

      const db = getUserDb('student_x');
      await assertFails(
        updateDoc(doc(db, 'users', 'student_x'), {
          role: 'TEACHER',
        })
      );
    });

    it('ALLOWS student to update allowed fields (displayName) while keeping role STUDENT', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', 'student_x'), {
          uid: 'student_x',
          email: 'x@quran.org',
          displayName: 'الاسم القديم',
          role: 'STUDENT',
        });
      });

      const db = getUserDb('student_x');
      await assertSucceeds(
        updateDoc(doc(db, 'users', 'student_x'), {
          displayName: 'الاسم الجديد',
          role: 'STUDENT',
        })
      );
    });
  });

  // ===============================================================
  // 5. Admin Verification & Email-Verified Defense
  // ===============================================================
  describe('5. Admin Verification & Email Security', () => {
    it('DENIES unverified admin email from listing all users', async () => {
      const db = getUnverifiedAdminDb();
      await assertFails(getDocs(collection(db, 'users')));
    });

    it('DENIES unverified admin email from accessing arbitrary student profiles', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', 'target_student'), {
          uid: 'target_student',
          email: 'target@quran.org',
          role: 'STUDENT',
        });
      });

      const db = getUnverifiedAdminDb();
      await assertFails(getDoc(doc(db, 'users', 'target_student')));
    });

    it('ALLOWS verified admin email to list all users and inspect profiles', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', 'target_student'), {
          uid: 'target_student',
          email: 'target@quran.org',
          role: 'STUDENT',
        });
      });

      const db = getVerifiedAdminDb();
      await assertSucceeds(getDocs(collection(db, 'users')));
      await assertSucceeds(getDoc(doc(db, 'users', 'target_student')));
    });

    it('ALLOWS verified admin to assign role ADMIN', async () => {
      const db = getVerifiedAdminDb();
      await assertSucceeds(
        setDoc(doc(db, 'users', 'real_admin_uid'), {
          uid: 'real_admin_uid',
          email: 'ahmed.sheta89@gmail.com',
          role: 'ADMIN',
        })
      );
    });
  });

  // ===============================================================
  // 6. Admin Custom Claims Verification
  // ===============================================================
  describe('6. Admin Custom Claims Authorization', () => {
    it('ALLOWS user with admin: true custom claim to execute admin actions', async () => {
      const db = getClaimAdminDb();
      await assertSucceeds(getDocs(collection(db, 'users')));
    });

    it('DENIES user with admin: false custom claim from executing admin actions', async () => {
      const db = getNonAdminClaimDb();
      await assertFails(getDocs(collection(db, 'users')));
    });
  });

  // ===============================================================
  // 7. Certificates Lifecycle & Two-Tier Privacy Architecture
  // ===============================================================
  describe('7. Certificates Lifecycle & Two-Tier Privacy Architecture', () => {
    const validFullCert = {
      certificateId: 'cert_1001',
      userId: 'student_a',
      studentName: 'أحمد محمود',
      surahNumber: 1,
      surahName: 'الفاتحة',
      accuracyScore: 98,
      verificationHash: 'sha256_mock_hash_1234567890abcdef',
      issuedAt: new Date().toISOString(),
    };

    const validPublicCert = {
      certificateId: 'cert_pub_1001',
      studentName: 'أحمد محمود',
      surahNumber: 1,
      surahName: 'الفاتحة',
      accuracyScore: 98,
      verificationHash: 'sha256_mock_hash_1234567890abcdef',
      issuedAt: new Date().toISOString(),
    };

    it('ALLOWS public (unauthenticated) to verify public certificate by ID', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'public_certificates', 'cert_pub_1001'), validPublicCert);
      });

      const db = getUnauthDb();
      const docSnap = await getDoc(doc(db, 'public_certificates', 'cert_pub_1001'));
      expect(docSnap.exists()).toBe(true);
      const data = docSnap.data();
      expect(data?.studentName).toBe('أحمد محمود');
      expect(data?.surahNumber).toBe(1);
      // Rigorous Proof: Public certificate strictly has NO userId
      expect(data?.userId).toBeUndefined();
    });

    it('DENIES public (unauthenticated) from listing public_certificates collection', async () => {
      const db = getUnauthDb();
      await assertFails(getDocs(collection(db, 'public_certificates')));
    });

    it('DENIES public (unauthenticated) from reading private user certificate in /users/{uid}/certificates', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', 'student_a', 'certificates', 'cert_1001'), validFullCert);
      });

      const db = getUnauthDb();
      await assertFails(getDoc(doc(db, 'users', 'student_a', 'certificates', 'cert_1001')));
    });

    it('DENIES public (unauthenticated) from reading legacy /certificates (Privacy Leak Closed)', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'certificates', 'cert_1001'), validFullCert);
      });

      const db = getUnauthDb();
      // Legacy endpoint now requires authenticated owner or admin
      await assertFails(getDoc(doc(db, 'certificates', 'cert_1001')));
    });

    it('ALLOWS authenticated student to create valid public certificate without userId', async () => {
      const db = getUserDb('student_a');
      await assertSucceeds(setDoc(doc(db, 'public_certificates', 'cert_pub_1001'), validPublicCert));
    });

    it('DENIES creating public certificate if payload contains private userId', async () => {
      const db = getUserDb('student_a');
      const taintedCert = {
        ...validPublicCert,
        certificateId: 'cert_pub_tainted',
        userId: 'student_a', // FORBIDDEN in public_certificates schema
      };
      await assertFails(setDoc(doc(db, 'public_certificates', 'cert_pub_tainted'), taintedCert));
    });

    it('ALLOWS student to issue private certificate for their OWN UID in /users/{uid}/certificates', async () => {
      const db = getUserDb('student_a');
      await assertSucceeds(setDoc(doc(db, 'users', 'student_a', 'certificates', 'cert_1001'), validFullCert));
    });

    it('DENIES student B from reading student A private certificate in /users/student_a/certificates', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', 'student_a', 'certificates', 'cert_1001'), validFullCert);
      });

      const dbB = getUserDb('student_b');
      await assertFails(getDoc(doc(dbB, 'users', 'student_a', 'certificates', 'cert_1001')));
    });

    it('DENIES student B from reading student A legacy certificate in /certificates', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'certificates', 'cert_1001'), validFullCert);
      });

      const dbB = getUserDb('student_b');
      await assertFails(getDoc(doc(dbB, 'certificates', 'cert_1001')));
    });

    it('DENIES student from issuing certificate under another student UID', async () => {
      const db = getUserDb('attacker');
      const forgedCert = {
        ...validFullCert,
        userId: 'student_a',
      };
      await assertFails(setDoc(doc(db, 'certificates', 'cert_1001'), forgedCert));
      await assertFails(setDoc(doc(db, 'users', 'student_a', 'certificates', 'cert_1001'), forgedCert));
    });

    it('DENIES public certificate modification once issued (Immutable)', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'public_certificates', 'cert_pub_1001'), validPublicCert);
      });

      const db = getUserDb('student_a');
      await assertFails(
        updateDoc(doc(db, 'public_certificates', 'cert_pub_1001'), {
          accuracyScore: 100,
        })
      );
    });

    it('DENIES student from deleting their own issued public certificate', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'public_certificates', 'cert_pub_1001'), validPublicCert);
      });

      const db = getUserDb('student_a');
      await assertFails(deleteDoc(doc(db, 'public_certificates', 'cert_pub_1001')));
    });

    it('ALLOWS super admin to revoke/delete an issued public certificate', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'public_certificates', 'cert_pub_1001'), validPublicCert);
      });

      const db = getVerifiedAdminDb();
      await assertSucceeds(deleteDoc(doc(db, 'public_certificates', 'cert_pub_1001')));
    });
  });

  // ===============================================================
  // 8. Subcollections Security: Profiles & Recitations
  // ===============================================================
  describe('8. Subcollections Security: Profiles and Recitations', () => {
    it('ALLOWS Student A to manage their own /profiles subcollection', async () => {
      const db = getUserDb('student_a');
      const profileData = {
        studentId: 'prof_1',
        userId: 'student_a',
        currentSurah: 2,
        currentAyah: 255,
        totalAyahsMemorized: 150,
        overallRetentionRate: 95,
      };

      await assertSucceeds(
        setDoc(doc(db, 'users', 'student_a', 'profiles', 'prof_1'), profileData)
      );
      await assertSucceeds(
        getDoc(doc(db, 'users', 'student_a', 'profiles', 'prof_1'))
      );
    });

    it('DENIES Student B from reading Student A /profiles subcollection', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(
          doc(context.firestore(), 'users', 'student_a', 'profiles', 'prof_1'),
          {
            studentId: 'prof_1',
            userId: 'student_a',
            currentSurah: 1,
          }
        );
      });

      const dbB = getUserDb('student_b');
      await assertFails(
        getDoc(doc(dbB, 'users', 'student_a', 'profiles', 'prof_1'))
      );
    });

    it('DENIES Student A from injecting mismatched userId in /profiles', async () => {
      const db = getUserDb('student_a');
      const invalidData = {
        studentId: 'prof_1',
        userId: 'student_b', // Mismatched foreign key
        currentSurah: 1,
      };
      await assertFails(
        setDoc(doc(db, 'users', 'student_a', 'profiles', 'prof_1'), invalidData)
      );
    });

    it('ALLOWS Student A to record recitation session under /recitations', async () => {
      const db = getUserDb('student_a');
      const recData = {
        sessionId: 'session_99',
        userId: 'student_a',
        surahNumber: 1,
        ayahNumber: 7,
        mode: 'OPEN_MUSHAF',
        accuracyScore: 92,
        tajweedScore: 88,
        fluencyScore: 90,
      };

      await assertSucceeds(
        setDoc(doc(db, 'users', 'student_a', 'recitations', 'session_99'), recData)
      );
      await assertSucceeds(
        getDoc(doc(db, 'users', 'student_a', 'recitations', 'session_99'))
      );
    });

    it('DENIES Student B from reading Student A recitation sessions', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(
          doc(context.firestore(), 'users', 'student_a', 'recitations', 'session_99'),
          {
            sessionId: 'session_99',
            userId: 'student_a',
            surahNumber: 1,
            ayahNumber: 7,
            mode: 'BLIND_TEST',
          }
        );
      });

      const dbB = getUserDb('student_b');
      await assertFails(
        getDoc(doc(dbB, 'users', 'student_a', 'recitations', 'session_99'))
      );
    });

    it('DENIES unauthenticated user from reading student profiles subcollection', async () => {
      const db = getUnauthDb();
      await assertFails(
        getDoc(doc(db, 'users', 'student_a', 'profiles', 'prof_1'))
      );
    });

    it('DENIES unauthenticated user from reading student recitations subcollection', async () => {
      const db = getUnauthDb();
      await assertFails(
        getDoc(doc(db, 'users', 'student_a', 'recitations', 'session_99'))
      );
    });

    it('DENIES Student B from deleting Student A profile in /profiles', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(
          doc(context.firestore(), 'users', 'student_a', 'profiles', 'prof_del'),
          {
            studentId: 'prof_del',
            userId: 'student_a',
          }
        );
      });

      const dbB = getUserDb('student_b');
      await assertFails(
        deleteDoc(doc(dbB, 'users', 'student_a', 'profiles', 'prof_del'))
      );
    });

    it('DENIES Student B from deleting Student A recitation in /recitations', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(
          doc(context.firestore(), 'users', 'student_a', 'recitations', 'rec_del'),
          {
            sessionId: 'rec_del',
            userId: 'student_a',
            surahNumber: 1,
            ayahNumber: 1,
            mode: 'OPEN_MUSHAF',
          }
        );
      });

      const dbB = getUserDb('student_b');
      await assertFails(
        deleteDoc(doc(dbB, 'users', 'student_a', 'recitations', 'rec_del'))
      );
    });
  });

  // ===============================================================
  // 9. Schema Violations & Negative Tests
  // ===============================================================
  describe('9. Schema Validation & Negative Boundary Tests', () => {
    it('DENIES user profile with unknown/unregistered fields', async () => {
      const db = getUserDb('student_a');
      const dirtyProfile = {
        uid: 'student_a',
        email: 'student_a@student.quran',
        unauthorizedField: 'malicious_payload',
      };
      await assertFails(setDoc(doc(db, 'users', 'student_a'), dirtyProfile));
    });

    it('DENIES user profile when docId does not match data.uid', async () => {
      const db = getUserDb('student_a');
      const mismatchProfile = {
        uid: 'mismatched_uid',
        email: 'student_a@student.quran',
      };
      await assertFails(setDoc(doc(db, 'users', 'student_a'), mismatchProfile));
    });

    it('DENIES student profile with invalid out-of-range surahNumber (> 114)', async () => {
      const db = getUserDb('student_a');
      const invalidSurahProfile = {
        studentId: 'p1',
        userId: 'student_a',
        currentSurah: 999, // Max is 114
      };
      await assertFails(
        setDoc(doc(db, 'users', 'student_a', 'profiles', 'p1'), invalidSurahProfile)
      );
    });

    it('DENIES recitation session with invalid mode string', async () => {
      const db = getUserDb('student_a');
      const invalidModeRec = {
        sessionId: 's1',
        userId: 'student_a',
        surahNumber: 1,
        ayahNumber: 1,
        mode: 'UNAUTHORIZED_MODE',
      };
      await assertFails(
        setDoc(doc(db, 'users', 'student_a', 'recitations', 's1'), invalidModeRec)
      );
    });
  });

  // ===============================================================
  // 10. Smoke Test Endpoint /test/connection
  // ===============================================================
  describe('10. Smoke Test Endpoint (/test/connection)', () => {
    it('ALLOWS public read of /test/connection', async () => {
      const db = getUnauthDb();
      await assertSucceeds(getDoc(doc(db, 'test', 'connection')));
    });

    it('DENIES writing to /test/connection by anyone', async () => {
      const db = getUnauthDb();
      await assertFails(setDoc(doc(db, 'test', 'connection'), { ping: true }));

      const authDb = getUserDb('student_a');
      await assertFails(setDoc(doc(authDb, 'test', 'connection'), { ping: true }));
    });

    it('DENIES listing the /test collection', async () => {
      const db = getUnauthDb();
      await assertFails(getDocs(collection(db, 'test')));
    });
  });

  // ===============================================================
  // 11. Offline-First Sync Subcollections (/sync_events, /sync_cursors)
  // ===============================================================
  describe('11. Offline-First Sync Subcollections Security', () => {
    const validEnvelope = {
      syncEventId: 'sync_001',
      eventId: 'evt_001',
      studentId: 'student_a',
      userId: 'student_a',
      deviceId: 'device_iphone_15',
      sessionId: 'session_rec_42',
      sequenceNumber: 1,
      eventHash: 'hash_sha256_event_001',
      previousEventHash: '0000000000000000000000000000000000000000000000000000000000000000',
      schemaVersion: '1.0.0',
      protocolVersion: '1.0.0',
      createdAt: 1729320000000,
      originDeviceId: 'device_iphone_15',
      originSequence: 1,
      payload: {
        surahNumber: 1,
        ayahNumber: 1,
        retentionScore: 98,
        mode: 'OPEN_MUSHAF',
      },
      payloadHash: 'hash_sha256_payload_001',
      envelopeHash: 'hash_sha256_envelope_001',
    };

    const validCursor = {
      studentId: 'student_a',
      userId: 'student_a',
      lastServerCursor: '1729320000000',
      lastAppliedRemoteSequence: 5,
      acknowledgedSequence: 5,
      updatedAt: 1729320050000,
    };

    // --- Subcollection: sync_events ---
    it('ALLOWS Student A to create and read their own sync event in /sync_events', async () => {
      const db = getUserDb('student_a');
      await assertSucceeds(
        setDoc(doc(db, 'users', 'student_a', 'sync_events', 'sync_001'), validEnvelope)
      );
      await assertSucceeds(
        getDoc(doc(db, 'users', 'student_a', 'sync_events', 'sync_001'))
      );
    });

    it('ALLOWS Student A to list their own /sync_events subcollection', async () => {
      const db = getUserDb('student_a');
      await assertSucceeds(
        getDocs(collection(db, 'users', 'student_a', 'sync_events'))
      );
    });

    it('DENIES Student B from reading Student A sync events', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(
          doc(context.firestore(), 'users', 'student_a', 'sync_events', 'sync_001'),
          validEnvelope
        );
      });

      const dbB = getUserDb('student_b');
      await assertFails(
        getDoc(doc(dbB, 'users', 'student_a', 'sync_events', 'sync_001'))
      );
    });

    it('DENIES Student B from listing Student A sync events', async () => {
      const dbB = getUserDb('student_b');
      await assertFails(
        getDocs(collection(dbB, 'users', 'student_a', 'sync_events'))
      );
    });

    it('DENIES creating sync event with mismatched syncEventId vs docId', async () => {
      const db = getUserDb('student_a');
      const mismatchedIdEnv = {
        ...validEnvelope,
        syncEventId: 'sync_other_id',
      };
      await assertFails(
        setDoc(doc(db, 'users', 'student_a', 'sync_events', 'sync_001'), mismatchedIdEnv)
      );
    });

    it('DENIES creating sync event with mismatched userId', async () => {
      const db = getUserDb('student_a');
      const mismatchedUserEnv = {
        ...validEnvelope,
        userId: 'student_b',
      };
      await assertFails(
        setDoc(doc(db, 'users', 'student_a', 'sync_events', 'sync_001'), mismatchedUserEnv)
      );
    });

    it('DENIES updating an existing sync event (Strict Immutability)', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(
          doc(context.firestore(), 'users', 'student_a', 'sync_events', 'sync_001'),
          validEnvelope
        );
      });

      const db = getUserDb('student_a');
      await assertFails(
        updateDoc(doc(db, 'users', 'student_a', 'sync_events', 'sync_001'), {
          sequenceNumber: 2,
        })
      );
    });

    it('DENIES Student A from deleting their own sync event (Admin Only)', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(
          doc(context.firestore(), 'users', 'student_a', 'sync_events', 'sync_001'),
          validEnvelope
        );
      });

      const db = getUserDb('student_a');
      await assertFails(
        deleteDoc(doc(db, 'users', 'student_a', 'sync_events', 'sync_001'))
      );
    });

    it('ALLOWS Super Admin to delete a sync event', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(
          doc(context.firestore(), 'users', 'student_a', 'sync_events', 'sync_001'),
          validEnvelope
        );
      });

      const dbAdmin = getVerifiedAdminDb();
      await assertSucceeds(
        deleteDoc(doc(dbAdmin, 'users', 'student_a', 'sync_events', 'sync_001'))
      );
    });

    it('DENIES creating sync event with raw audio leak in payload (audioBuffer)', async () => {
      const db = getUserDb('student_a');
      const taintedEnv = {
        ...validEnvelope,
        payload: {
          ...validEnvelope.payload,
          audioBuffer: 'simulated_raw_audio_buffer',
        },
      };
      await assertFails(
        setDoc(doc(db, 'users', 'student_a', 'sync_events', 'sync_001'), taintedEnv)
      );
    });

    it('DENIES creating sync event with rawAudioSync or rawAudioPersistence', async () => {
      const db = getUserDb('student_a');
      const taintedEnv1 = {
        ...validEnvelope,
        rawAudioSync: true,
      };
      await assertFails(
        setDoc(doc(db, 'users', 'student_a', 'sync_events', 'sync_001'), taintedEnv1)
      );

      const taintedEnv2 = {
        ...validEnvelope,
        payload: {
          ...validEnvelope.payload,
          rawAudioPersistence: true,
        },
      };
      await assertFails(
        setDoc(doc(db, 'users', 'student_a', 'sync_events', 'sync_001'), taintedEnv2)
      );
    });

    it('DENIES creating sync event with missing required fields (e.g. envelopeHash)', async () => {
      const db = getUserDb('student_a');
      const { envelopeHash, ...incompleteEnv } = validEnvelope;
      await assertFails(
        setDoc(doc(db, 'users', 'student_a', 'sync_events', 'sync_001'), incompleteEnv)
      );
    });

    it('DENIES creating sync event with unauthorized extra fields (Schema Pollution)', async () => {
      const db = getUserDb('student_a');
      const dirtyEnv = {
        ...validEnvelope,
        unauthorizedField: 'malicious_injection',
      };
      await assertFails(
        setDoc(doc(db, 'users', 'student_a', 'sync_events', 'sync_001'), dirtyEnv)
      );
    });

    // --- Subcollection: sync_cursors ---
    it('ALLOWS Student A to create, read, and update their own sync cursor in /sync_cursors', async () => {
      const db = getUserDb('student_a');
      await assertSucceeds(
        setDoc(doc(db, 'users', 'student_a', 'sync_cursors', 'default'), validCursor)
      );
      await assertSucceeds(
        getDoc(doc(db, 'users', 'student_a', 'sync_cursors', 'default'))
      );
      await assertSucceeds(
        updateDoc(doc(db, 'users', 'student_a', 'sync_cursors', 'default'), {
          lastAppliedRemoteSequence: 10,
          acknowledgedSequence: 10,
          updatedAt: 1729320100000,
        })
      );
    });

    it('ALLOWS sync cursor with null lastServerCursor', async () => {
      const db = getUserDb('student_a');
      const nullCursor = {
        ...validCursor,
        lastServerCursor: null,
      };
      await assertSucceeds(
        setDoc(doc(db, 'users', 'student_a', 'sync_cursors', 'initial'), nullCursor)
      );
    });

    it('DENIES Student B from reading or updating Student A sync cursor', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(
          doc(context.firestore(), 'users', 'student_a', 'sync_cursors', 'default'),
          validCursor
        );
      });

      const dbB = getUserDb('student_b');
      await assertFails(
        getDoc(doc(dbB, 'users', 'student_a', 'sync_cursors', 'default'))
      );
      await assertFails(
        updateDoc(doc(dbB, 'users', 'student_a', 'sync_cursors', 'default'), {
          lastAppliedRemoteSequence: 99,
        })
      );
    });

    it('DENIES Student A from deleting their own sync cursor (Admin Only)', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(
          doc(context.firestore(), 'users', 'student_a', 'sync_cursors', 'default'),
          validCursor
        );
      });

      const db = getUserDb('student_a');
      await assertFails(
        deleteDoc(doc(db, 'users', 'student_a', 'sync_cursors', 'default'))
      );
    });

    it('ALLOWS Super Admin to delete a sync cursor', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(
          doc(context.firestore(), 'users', 'student_a', 'sync_cursors', 'default'),
          validCursor
        );
      });

      const dbAdmin = getVerifiedAdminDb();
      await assertSucceeds(
        deleteDoc(doc(dbAdmin, 'users', 'student_a', 'sync_cursors', 'default'))
      );
    });

    it('DENIES sync cursor with mismatched userId', async () => {
      const db = getUserDb('student_a');
      const taintedCursor = {
        ...validCursor,
        userId: 'student_b',
      };
      await assertFails(
        setDoc(doc(db, 'users', 'student_a', 'sync_cursors', 'default'), taintedCursor)
      );
    });

    it('DENIES sync cursor with missing required fields', async () => {
      const db = getUserDb('student_a');
      const { lastAppliedRemoteSequence, ...incompleteCursor } = validCursor;
      await assertFails(
        setDoc(doc(db, 'users', 'student_a', 'sync_cursors', 'default'), incompleteCursor)
      );
    });
  });
});
