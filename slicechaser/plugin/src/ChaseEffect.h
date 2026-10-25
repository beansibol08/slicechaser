// Base class for SliceChaser effects: owns the Sequence and Scaling parameters,
// keeps the Sequence buttons in sync with the chase file, and draws slices.
#pragma once
#include <FFGLSDK.h>
#include <string>
#include <vector>
#include "ChaseData.h"
#include "SliceRenderer.h"

namespace sc
{
class ChaseEffect : public CFFGLPlugin
{
public:
	// Every effect puts Sequence and Scaling first so they line up across plugins.
	enum : unsigned int
	{
		PID_SEQUENCE = 0,
		PID_SCALING  = 1,
		PID_FIRST_CUSTOM
	};

	ChaseEffect();

	FFResult InitGL( const FFGLViewportStruct* vp ) override;
	FFResult DeInitGL() override;
	FFResult ProcessOpenGL( ProcessOpenGLStruct* pGL ) override;

	FFResult SetFloatParameter( unsigned int index, float value ) override;
	float GetFloatParameter( unsigned int index ) override;

protected:
	// Fill `opacities` (one per slice) for this frame. `seq` is null when nothing is selected.
	virtual void ComputeOpacities( const ChaseFile& file, const Sequence* seq, std::vector< float >& opacities ) = 0;
	virtual FFResult SetCustomFloat( unsigned int index, float value ) = 0;
	virtual float GetCustomFloat( unsigned int index ) = 0;
	// Called when the selected sequence changes or the file reloads.
	virtual void OnSequenceChanged()
	{
	}

	const Sequence* SelectedSequence() const;

private:
	void RefreshSequenceOptions( bool raiseEvent );

	SliceRenderer renderer;
	std::shared_ptr< const ChaseFile > file;
	uint64_t revision     = ~0ull;
	float sequenceValue   = 0.0f;
	float scalingValue    = 0.0f;
	std::vector< float > opacities;
};

}//namespace sc
