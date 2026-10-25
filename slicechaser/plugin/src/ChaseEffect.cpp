#include "ChaseEffect.h"
#include <cmath>

namespace sc
{
ChaseEffect::ChaseEffect()
{
	SetMinInputs( 1 );
	SetMaxInputs( 1 );

	file = ChaseLibrary::Get().Current( &revision );

	// Sequence: one button per sequence in the chase file. Values are the sequence ids,
	// so a saved composition keeps pointing at the same sequence after renames or reordering.
	SetOptionParamInfo( PID_SEQUENCE, "Sequence", 0, 0.0f );
	RefreshSequenceOptions( false );

	SetOptionParamInfo( PID_SCALING, "Scaling", 3, 0.0f );
	SetParamElementInfo( PID_SCALING, 0, "Fill", 0.0f );
	SetParamElementInfo( PID_SCALING, 1, "Mask", 1.0f );
	SetParamElementInfo( PID_SCALING, 2, "Stretch", 2.0f );
}

void ChaseEffect::RefreshSequenceOptions( bool raiseEvent )
{
	std::vector< std::string > names;
	std::vector< float > values;
	for( const Sequence& s : file->sequences )
	{
		names.push_back( s.name.empty() ? std::string( "Sequence " ) + std::to_string( s.id ) : s.name );
		values.push_back( (float)s.id );
	}
	if( names.empty() )
	{
		// An option parameter needs at least one element.
		names.push_back( file->slices.empty() ? "No chase file yet" : "No sequences yet" );
		values.push_back( 0.0f );
	}
	SetParamElements( PID_SEQUENCE, names, values, raiseEvent );

	// Keep the current selection if it still exists, otherwise fall back to the first sequence.
	bool found = false;
	for( float v : values )
		found = found || v == sequenceValue;
	if( !found )
	{
		sequenceValue = values.front();
		if( raiseEvent )
			RaiseParamEvent( PID_SEQUENCE, FF_EVENT_FLAG_VALUE );
	}
	if( !raiseEvent )
	{
		// During construction this also becomes the default shown in Resolume.
		if( ParamInfo* info = FindParamInfo( PID_SEQUENCE ) )
			info->defaultFloatVal = sequenceValue;
	}
}

const Sequence* ChaseEffect::SelectedSequence() const
{
	return file->FindSequence( (int)std::lround( sequenceValue ) );
}

FFResult ChaseEffect::InitGL( const FFGLViewportStruct* vp )
{
	if( !renderer.InitGL() )
	{
		DeInitGL();
		return FF_FAIL;
	}
	return CFFGLPlugin::InitGL( vp );
}

FFResult ChaseEffect::DeInitGL()
{
	renderer.DeInitGL();
	return FF_SUCCESS;
}

FFResult ChaseEffect::ProcessOpenGL( ProcessOpenGLStruct* pGL )
{
	if( pGL->numInputTextures < 1 || pGL->inputTextures[ 0 ] == nullptr )
		return FF_FAIL;

	uint64_t rev = 0;
	auto latest  = ChaseLibrary::Get().Current( &rev );
	if( rev != revision )
	{
		file     = latest;
		revision = rev;
		RefreshSequenceOptions( true );
		OnSequenceChanged();
	}
	renderer.Sync( *file, revision );

	ComputeOpacities( *file, SelectedSequence(), opacities );
	renderer.Draw( *pGL->inputTextures[ 0 ], opacities, (Scaling)(int)std::lround( scalingValue ) );
	return FF_SUCCESS;
}

FFResult ChaseEffect::SetFloatParameter( unsigned int index, float value )
{
	switch( index )
	{
	case PID_SEQUENCE:
		if( value != sequenceValue )
		{
			sequenceValue = value;
			OnSequenceChanged();
		}
		return FF_SUCCESS;
	case PID_SCALING:
		scalingValue = value;
		return FF_SUCCESS;
	default:
		return SetCustomFloat( index, value );
	}
}

float ChaseEffect::GetFloatParameter( unsigned int index )
{
	switch( index )
	{
	case PID_SEQUENCE: return sequenceValue;
	case PID_SCALING: return scalingValue;
	default: return GetCustomFloat( index );
	}
}

}//namespace sc
