export interface ProgressTask {
  update(label: string): void;
  end(): void;
}

export interface Progress {
  begin(label: string): ProgressTask;
}

/**
 * 진행 표시를 여러 작업이 함께 쓴다. 겹친 작업 중 하나가 끝나도 다른 작업이 남아 있으면 표시를 유지하고,
 * 가장 최근에 시작해 아직 남은 작업의 문구를 보여 준다.
 */
export function createProgress(show: (label: string) => void, hide: () => void): Progress {
  const active: { label: string }[] = [];
  const refresh = () => (active.length ? show(active[active.length - 1].label) : hide());
  return {
    begin(label) {
      const task = { label };
      active.push(task);
      refresh();
      let ended = false;
      return {
        update(next) {
          task.label = next;
          if (!ended) refresh();
        },
        end() {
          if (ended) return;
          ended = true;
          active.splice(active.indexOf(task), 1);
          refresh();
        },
      };
    },
  };
}
