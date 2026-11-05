/**
 * 共享数据钩子：拉项目/配置 + 订阅 SSE。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchConfig, fetchProject, subscribeEvents, type ApiProject } from '../api'

export function useProject(ws: string): {
  project: ApiProject | null
  config: unknown
  error: string | null
  reload: () => void
} {
  const [project, setProject] = useState<ApiProject | null>(null)
  const [config, setConfig] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  const reload = useCallback(() => {
    void fetchProject(ws)
      .then((p) => {
        if (mounted.current) {
          setProject(p)
          setError(null)
        }
      })
      .catch((e: Error) => mounted.current && setError(e.message))
    void fetchConfig(ws).then((c) => mounted.current && setConfig(c))
  }, [ws])

  useEffect(() => {
    mounted.current = true
    reload()
    return () => {
      mounted.current = false
    }
  }, [reload])

  useEffect(() => {
    return subscribeEvents(ws, {
      onProject: reload,
      onFrames: reload,
      onJob: reload,
      onConfig: reload,
    })
  }, [reload])

  return { project, config, error, reload }
}
