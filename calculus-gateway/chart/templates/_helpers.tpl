{{/*
Expand the name of the chart.
*/}}
{{- define "calculus-gateway.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "calculus-gateway.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "calculus-gateway.labels" -}}
helm.sh/chart: {{ include "calculus-gateway.name" . }}-{{ .Chart.Version | replace "+" "_" }}
{{ include "calculus-gateway.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "calculus-gateway.selectorLabels" -}}
app.kubernetes.io/name: {{ include "calculus-gateway.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
