"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface IntakeSummary {
  total: number;
  notStarted: number;
  running: number;
  complete: number;
  failed: number;
}

interface CandidateSummary {
  total: number;
  notEnriched: number;
  complete: number;
  failed: number;
}

export default function DashboardPage() {
  const [intake, setIntake] = useState<IntakeSummary | null>(null);
  const [candidates, setCandidates] = useState<CandidateSummary | null>(null);

  useEffect(() => {
    fetch("/api/submissions")
      .then((r) => r.json())
      .then((submissions: { counts: { total: number; not_started: number; running: number; complete: number; failed: number } }[]) => {
        const totals = submissions.reduce(
          (acc, s) => ({
            total: acc.total + (s.counts?.total ?? 0),
            notStarted: acc.notStarted + (s.counts?.not_started ?? 0),
            running: acc.running + (s.counts?.running ?? 0),
            complete: acc.complete + (s.counts?.complete ?? 0),
            failed: acc.failed + (s.counts?.failed ?? 0),
          }),
          { total: 0, notStarted: 0, running: 0, complete: 0, failed: 0 }
        );
        setIntake({ ...totals, total: submissions.length });
      })
      .catch(() => { });

    fetch("/api/candidates")
      .then((r) => r.json())
      .then((list: { enrichmentStatus: string | null }[]) => {
        setCandidates({
          total: list.length,
          notEnriched: list.filter((c) => !c.enrichmentStatus).length,
          complete: list.filter((c) => c.enrichmentStatus === "result_saved").length,
          failed: list.filter((c) => c.enrichmentStatus === "failed").length,
        });
      })
      .catch(() => { });
  }, []);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-lg font-bold text-gray-900">Civoren Console</h1>
        <p className="text-xs text-gray-400 mt-1">Select an entity type to enrich</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
        {/* CRM Intake card */}
        <div className="bg-white border border-gray-200 rounded p-5">
          <div className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-medium">CRM Intake</div>
          {intake ? (
            <>
              <div className="text-2xl font-bold text-gray-900 mb-1">{intake.total}</div>
              <div className="text-xs text-gray-400 mb-1">submissions</div>
              <div className="flex flex-wrap gap-2 mt-3 text-xs">
                {intake.notStarted > 0 && (
                  <span className="text-gray-500">{intake.notStarted} not started</span>
                )}
                {intake.running > 0 && (
                  <span className="text-blue-600">{intake.running} running</span>
                )}
                {intake.complete > 0 && (
                  <span className="text-green-600">{intake.complete} complete</span>
                )}
                {intake.failed > 0 && (
                  <span className="text-red-500">{intake.failed} failed</span>
                )}
              </div>
            </>
          ) : (
            <div className="text-gray-300 text-sm">Loading...</div>
          )}
          <div className="mt-4">
            <Link href="/intake" className="text-xs text-amber-600 hover:underline font-medium">
              View CRM Intake →
            </Link>
          </div>
        </div>

        {/* Candidates card */}
        <div className="bg-white border border-gray-200 rounded p-5">
          <div className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-medium">Candidates</div>
          {candidates ? (
            <>
              <div className="text-2xl font-bold text-gray-900 mb-1">{candidates.total}</div>
              <div className="text-xs text-gray-400 mb-1">candidates</div>
              <div className="flex flex-wrap gap-2 mt-3 text-xs">
                {candidates.notEnriched > 0 && (
                  <span className="text-gray-500">{candidates.notEnriched} not enriched</span>
                )}
                {candidates.complete > 0 && (
                  <span className="text-green-600">{candidates.complete} complete</span>
                )}
                {candidates.failed > 0 && (
                  <span className="text-red-500">{candidates.failed} failed</span>
                )}
              </div>
            </>
          ) : (
            <div className="text-gray-300 text-sm">Loading...</div>
          )}
          <div className="mt-4">
            <Link href="/candidates" className="text-xs text-amber-600 hover:underline font-medium">
              View Candidates →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
