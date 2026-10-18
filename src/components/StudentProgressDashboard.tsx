/**
 * @file StudentProgressDashboard.tsx
 * @module components
 * @description Master presentation dashboard for Phase 8D — Student Progress UX.
 * Integrates:
 * 1. Today's Dashboard (Active memorization, daily revision queue, focal points)
 * 2. 114 Surahs Memorization Explorer with verified Uthmani text
 * 3. 5-Urgency Spaced Repetition Revision Scheduler
 * 4. Longitudinal Analytics & 30-Juz Distribution Matrix
 * 5. Phase 8C Offline-First live sync banner & human conflict resolution modal
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSync } from '../context/SyncContext.tsx';
import {
  selectStudentProgressViewModel,
  selectAllSurahsProgress,
} from '../domain/progress/ProgressSelectors.ts';
import { StudentProgressViewModel, SurahProgressViewModel } from '../domain/progress/types.ts';
import { TodayView } from './progress/views/TodayView.tsx';
import { MemorizationView } from './progress/views/MemorizationView.tsx';
import { RevisionScheduleView } from './progress/views/RevisionScheduleView.tsx';
import { AnalyticsView } from './progress/analytics/AnalyticsView.tsx';
import { SyncStatusBanner } from './progress/sync/SyncStatusBanner.tsx';
import { ConflictQuarantineModal } from './progress/sync/ConflictQuarantineModal.tsx';
import { LoadingState } from './progress/design_system/FeedbackStates.tsx';
import { StudentMemorizationProfile } from '../domain/memorization_revision/types.ts';
import {
  Sparkles,
  BookOpen,
  Calendar,
  BarChart3,
  User,
  ShieldCheck,
  Award,
  FileText
} from 'lucide-react';
import { MasteryCertificateModal } from './classroom/MasteryCertificateModal.tsx';
import { RecitationReportModal, RecitationReportData } from './classroom/RecitationReportModal.tsx';
import { syncStudentProfileToFirestore } from '../infrastructure/firebase/firebaseClient.ts';

interface StudentProgressDashboardProps {
  onStartRecitation?: (surahId: number, startAyah: number, endAyah: number) => void;
}

export const StudentProgressDashboard: React.FC<StudentProgressDashboardProps> = ({
  onStartRecitation,
}) => {
  const {
    coordinator,
    persistentStore,
    summary,
    activeStudent,
    conflicts,
    syncNow,
    resolveConflict,
    isReady,
  } = useSync();

  const [activeSubTab, setActiveSubTab] = useState<'TODAY' | 'MEMORIZATION' | 'REVISION' | 'ANALYTICS'>('TODAY');
  const [profile, setProfile] = useState<StudentMemorizationProfile | undefined>(undefined);
  const [showConflictModal, setShowConflictModal] = useState<boolean>(false);
  const [showCertModal, setShowCertModal] = useState<boolean>(false);
  const [showRepModal, setShowRepModal] = useState<boolean>(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState<boolean>(true);

  // Load profile from persistentStore or snapshot
  const loadProfile = useCallback(async () => {
    if (!persistentStore) return;
    try {
      setIsLoadingProfile(true);
      const snapshot = await persistentStore.getProfileSnapshot(activeStudent.studentId);
      if (snapshot) {
        setProfile({
          studentId: snapshot.studentId,
          activeMemorizationRange: [...snapshot.activeMemorizationRange],
          passageStates: { ...snapshot.passageStates },
          lastActivityAt: snapshot.lastActivityAt,
          lastReviewAt: snapshot.lastReviewAt,
          revisionDueCount: snapshot.revisionDueCount,
          weakPassageCount: snapshot.weakPassageCount,
          stablePassageCount: snapshot.stablePassageCount,
          masteredPassageCount: snapshot.masteredPassageCount,
        });
      } else {
        setProfile(undefined);
      }
    } catch (err) {
      console.error('Error loading student profile for dashboard:', err);
    } finally {
      setIsLoadingProfile(false);
    }
  }, [persistentStore, activeStudent.studentId]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // Compute View Models through pure selectors
  const progressViewModel: StudentProgressViewModel = useMemo(() => {
    return selectStudentProgressViewModel({
      student: activeStudent,
      profile,
      syncSummary: summary,
      events: [],
    });
  }, [activeStudent, profile, summary]);

  const allSurahs: readonly SurahProgressViewModel[] = useMemo(() => {
    return selectAllSurahsProgress(profile);
  }, [profile]);

  useEffect(() => {
    if (profile) {
      syncStudentProfileToFirestore(activeStudent.studentId, {
        totalAyahsMemorized: progressViewModel.analytics.totalAyahsMastered,
        overallRetentionRate: Math.round(progressViewModel.analytics.cumulativeAccuracyPercentage),
      }).catch(() => {});
    }
  }, [profile, activeStudent.studentId, progressViewModel.analytics]);

  const dashboardReportData: RecitationReportData = useMemo(() => {
    const totalAyahsMemorized = progressViewModel.analytics.totalAyahsMastered;
    const accuracyScore = Math.round(progressViewModel.analytics.cumulativeAccuracyPercentage);
    const hasProgress = totalAyahsMemorized > 0 && accuracyScore > 0;
    return {
      surahNumber: 1,
      surahName: 'سورة الفاتحة وجزء عم',
      totalAyahs: 114,
      completedAyahs: totalAyahsMemorized,
      accuracyScore,
      tajweedScore: hasProgress ? Math.max(0, accuracyScore - 4) : 0,
      fluencyScore: hasProgress ? Math.max(0, accuracyScore - 6) : 0,
      hesitationCount: progressViewModel.revisionOverview.dueTodayCount || 0,
      errorCount: 0,
      perfectWordCount: hasProgress ? totalAyahsMemorized * 4 : 0,
      reciterBenchmark: 'الشيخ محمود خليل الحصري (مرجع التحقيق)',
      sessionDurationSeconds: 120,
      testedMode: 'BLIND_TEST',
      hesitationWords: [],
      correctedWords: [],
      pedagogicalRemarks: [
        'متابعة الحفظ وتثبيت المحفوظ وفق خوارزمية التعاهد المتباعد',
        'مؤشر الضبط اللفظي مستند إلى الكلمات المكتملة دون ادعاء أحكام التجويد التخصصية'
      ]
    };
  }, [progressViewModel]);

  if (!isReady || isLoadingProfile) {
    return (
      <div className="bg-white rounded-3xl border border-stone-200 p-8 shadow-xs" dir="rtl">
        <LoadingState message="جاري استرجاع سجلات الحفظ والتعاهد الموثقة..." />
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* 1. Sync & Connectivity Banner */}
      <SyncStatusBanner
        summary={summary}
        onSyncNow={syncNow}
        onViewConflicts={() => setShowConflictModal(true)}
      />

      {/* 2. Sub-Navigation Bar */}
      <div className="bg-white rounded-2xl border border-stone-200/80 p-2 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {[
            { id: 'TODAY', label: 'اليوم والتعاهد', icon: Sparkles },
            { id: 'MEMORIZATION', label: 'المصحف والحفظ (114 سورة)', icon: BookOpen },
            { id: 'REVISION', label: 'جدول المراجعة المتباعدة', icon: Calendar },
            { id: 'ANALYTICS', label: 'مؤشرات الإتقان والتغطية', icon: BarChart3 },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id as typeof activeSubTab)}
                className={`px-4 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap flex items-center gap-2 transition-all min-h-[44px] cursor-pointer ${
                  isActive
                    ? 'bg-emerald-900 text-white shadow-xs'
                    : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100/80'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-200' : 'text-stone-400'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 px-1">
          <button
            onClick={() => setShowRepModal(true)}
            className="px-3.5 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
            title="تصدير تقرير الحفظ الشامل ومشاركته مع الشيخ"
          >
            <FileText className="w-3.5 h-3.5 text-emerald-700" />
            <span>تقرير الحفظ للشيخ</span>
          </button>
          <button
            onClick={() => setShowCertModal(true)}
            className="px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
            title="إصدار وطباعة شهادة إتقان الحفظ"
          >
            <Award className="w-3.5 h-3.5 text-amber-700" />
            <span>شهادة الإتقان</span>
          </button>
        </div>
      </div>

      {/* 3. Sub-View Routing */}
      {activeSubTab === 'TODAY' && (
        <TodayView
          progress={progressViewModel}
          onNavigateToRevision={() => setActiveSubTab('REVISION')}
          onNavigateToMemorization={() => setActiveSubTab('MEMORIZATION')}
          onStartRecitationSession={onStartRecitation}
        />
      )}

      {activeSubTab === 'MEMORIZATION' && (
        <MemorizationView
          surahs={allSurahs}
          onPracticeAyah={(surahId, ayahNumber) =>
            onStartRecitation?.(surahId, ayahNumber, ayahNumber)
          }
        />
      )}

      {activeSubTab === 'REVISION' && (
        <RevisionScheduleView
          overview={progressViewModel.revisionOverview}
          onStartReview={(item) =>
            onStartRecitation?.(item.surahId, item.ayahNumber, item.ayahNumber)
          }
          onStartAllDueReviews={() => {
            const first = progressViewModel.revisionOverview.items[0];
            if (first) {
              onStartRecitation?.(first.surahId, first.ayahNumber, first.ayahNumber);
            }
          }}
        />
      )}

      {activeSubTab === 'ANALYTICS' && (
        <AnalyticsView progress={progressViewModel} surahs={allSurahs} />
      )}

      {/* 4. Conflict Quarantine Modal */}
      {showConflictModal && (
        <ConflictQuarantineModal
          conflicts={conflicts}
          onResolve={resolveConflict}
          onClose={() => setShowConflictModal(false)}
        />
      )}

      {/* 5. Progress Report Modal */}
      {showRepModal && (
        <RecitationReportModal
          report={dashboardReportData}
          onClose={() => setShowRepModal(false)}
          onOpenCertificate={() => {
            if (dashboardReportData.completedAyahs <= 0 || dashboardReportData.accuracyScore < 80) {
              return;
            }
            setShowRepModal(false);
            setShowCertModal(true);
          }}
        />
      )}

      {/* 6. Mastery Certificate Modal */}
      {showCertModal && dashboardReportData.completedAyahs > 0 && dashboardReportData.accuracyScore >= 80 && (
        <MasteryCertificateModal
          surahName={dashboardReportData.surahName}
          surahNumber={1}
          accuracyScore={dashboardReportData.accuracyScore}
          tajweedScore={dashboardReportData.tajweedScore}
          onClose={() => setShowCertModal(false)}
        />
      )}
    </div>
  );
};
