import { DetailSlideOver } from './ui/DetailSlideOver';
import { FileEdit, Facebook, Twitter, Linkedin, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">{title}</p>
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-[13px] text-[var(--text-primary)]">{value}</p>
    </div>
  );
}

function JobStatusPill({ status }: { status?: string | null }) {
  const cls =
    status === 'Active'  ? 'pill-success' :
    status === 'Closed'  ? 'pill-danger'  :
    status === 'On Hold' ? 'pill-warning' : '';
  return <span className={`pill ${cls}`}>{status ?? '—'}</span>;
}

function shareOnFacebook(url: string) {
  const left = Math.round(screen.width / 2 - 350);
  const top  = Math.round(screen.height / 2 - 250);
  window.open(
    `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    'Share on Facebook',
    `width=700,height=500,left=${left},top=${top}`,
  );
}

function shareOnTwitter(url: string, text: string) {
  const left = Math.round(screen.width / 2 - 275);
  const top  = Math.round(screen.height / 2 - 130);
  window.open(
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
    'Share on Twitter',
    `width=550,height=260,left=${left},top=${top},scrollbars=yes,resizable=yes`,
  );
}

function shareOnLinkedIn(url: string) {
  const left = Math.round(screen.width / 2 - 250);
  const top  = Math.round(screen.height / 2 - 250);
  window.open(
    `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
    'Share on LinkedIn',
    `width=500,height=500,left=${left},top=${top}`,
  );
}

interface Props {
  job: any;
  candidateCount: number;
  onClose: () => void;
  onEdit: () => void;
}

export function JobDetails({ job, candidateCount, onClose, onEdit }: Props) {
  const imageUrl = job.attachment
    ? `${api.defaults.baseURL}/documents/${job.attachment}`
    : null;

  const jobSlug = job.code || String(job.id);
  const shareUrl = `${window.location.origin}/careers/${jobSlug}`;
  const shareText = `${job.title}${job.location ? ` in ${job.location}` : ''}${job.country ? `, ${job.country}` : ''}. Apply Now!`;

  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl).then(() => toast.success('Link copied'));
  };

  return (
    <DetailSlideOver
      open
      title={job.title}
      subtitle={[job.department, job.location, job.country].filter(Boolean).join(' · ') || undefined}
      onClose={onClose}
      maxWidth="2xl"
      footerActions={
        <button className="secondary-btn" onClick={onEdit}>
          <FileEdit size={14} /> Edit Job
        </button>
      }
    >
      <div className="space-y-6">

        {/* Banner image */}
        {imageUrl && (
          <div className="w-full h-40 rounded-[12px] overflow-hidden border border-[var(--border)]">
            <img src={imageUrl} alt="Job banner" className="w-full h-full object-cover" />
          </div>
        )}

        {/* Status chips */}
        <div className="flex flex-wrap items-center gap-2">
          <JobStatusPill status={job.status} />
          {job.employementType && (
            <span className="pill pill-accent text-[11px]">{job.employementType}</span>
          )}
          {job.experienceLevel && (
            <span className="pill bg-purple-50 text-purple-700 border border-purple-200 text-[11px]">{job.experienceLevel}</span>
          )}
          {job.educationLevel && (
            <span className="pill bg-indigo-50 text-indigo-700 border border-indigo-200 text-[11px]">{job.educationLevel}</span>
          )}
          <span className="text-[12px] px-2.5 py-1 rounded-full bg-[var(--surface-hover)] border border-[var(--border)] text-[var(--text-secondary)]">
            {candidateCount} candidate{candidateCount !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Key details grid */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 p-4 rounded-[12px] border border-[var(--border)] bg-[var(--surface-hover)]">
          <DetailRow label="Job Code"      value={job.code} />
          <DetailRow label="Company"       value={job.companyName} />
          <DetailRow label="Job Function"  value={job.jobFunction} />
          <DetailRow label="Closing Date"  value={job.closingDate ? new Date(job.closingDate).toLocaleDateString() : null} />
          <DetailRow label="Position Reason" value={job.positionReason} />
          <DetailRow label="Keywords"      value={job.keywords} />
          {(job.salaryMin || job.salaryMax) && (
            <div className="col-span-2">
              <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-0.5">Salary Range</p>
              <p className="text-[13px] text-[var(--text-primary)]">
                {job.currency ? `${job.currency} ` : ''}
                {job.salaryMin ? Number(job.salaryMin).toLocaleString() : '—'}
                {' – '}
                {job.salaryMax ? Number(job.salaryMax).toLocaleString() : '—'}
                {job.showSalary === 'No' && (
                  <span className="ml-2 text-[11px] text-[var(--text-muted)]">(hidden from listing)</span>
                )}
              </p>
            </div>
          )}
        </div>

        {/* Job content */}
        {job.shortDescription && (
          <Section title="Summary">
            <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{job.shortDescription}</p>
          </Section>
        )}

        {job.description && (
          <Section title="Description">
            <p className="text-[13px] text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{job.description}</p>
          </Section>
        )}

        {job.requirements && (
          <Section title="Requirements">
            <p className="text-[13px] text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{job.requirements}</p>
          </Section>
        )}

        {job.benefits && (
          <Section title="Benefits">
            <p className="text-[13px] text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{job.benefits}</p>
          </Section>
        )}

        {/* Social share */}
        <div className="pt-2 border-t border-[var(--border)]">
          <p className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Share this Opening</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => shareOnFacebook(shareUrl)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] border border-[var(--border)] text-[12px] font-medium text-[#1877F2] hover:bg-blue-50 transition-colors"
            >
              <Facebook size={14} /> Facebook
            </button>
            <button
              onClick={() => shareOnTwitter(shareUrl, shareText)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] border border-[var(--border)] text-[12px] font-medium text-[#1DA1F2] hover:bg-sky-50 transition-colors"
            >
              <Twitter size={14} /> Twitter
            </button>
            <button
              onClick={() => shareOnLinkedIn(shareUrl)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] border border-[var(--border)] text-[12px] font-medium text-[#0A66C2] hover:bg-blue-50 transition-colors"
            >
              <Linkedin size={14} /> LinkedIn
            </button>
            <button
              onClick={copyLink}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] border border-[var(--border)] text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors"
            >
              <Link2 size={14} /> Copy Link
            </button>
          </div>
        </div>

      </div>
    </DetailSlideOver>
  );
}
